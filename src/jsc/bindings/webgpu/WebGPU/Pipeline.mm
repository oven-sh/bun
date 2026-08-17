/*
 * Copyright (c) 2023 Apple Inc. All rights reserved.
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. ``AS IS'' AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL APPLE INC. OR
 * CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
 * PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
 * PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY
 * OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
 * OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

#import "config.h"
#import "Pipeline.h"

#import "APIConversions.h"
#import "ShaderModule.h"
#import "WGSLShaderModule.h"

#if !defined(NDEBUG) || (defined(ENABLE_LIBFUZZER) && ENABLE_LIBFUZZER && defined(ASAN_ENABLED) && ASAN_ENABLED)
#include <csignal>
#include <cstdlib>
#include <wtf/FileHandle.h>
#include <wtf/FileSystem.h>
#include <wtf/text/MakeString.h>
#include <wtf/text/StringBuilder.h>
#endif

namespace WebGPU {

std::optional<LibraryCreationResult> createLibrary(id<MTLDevice> device, const ShaderModule& shaderModule, PipelineLayout* pipelineLayout, const String& entryPoint, NSString *label, std::span<const WGPUConstantEntry> constants, BufferBindingSizesForPipeline& mininumBufferSizes, NSError **error, String& metalShaderSource)
{
    HashMap<String, WGSL::ConstantValue> wgslConstantValues;

    if (!entryPoint.length() || !shaderModule.isValid())
        return std::nullopt;

    if (shaderModule.library() && pipelineLayout) {
        if (const RefPtr pipelineLayoutHint = shaderModule.pipelineLayoutHint(entryPoint)) {
            if (*pipelineLayoutHint == *pipelineLayout) {
                if (const auto* entryPointInformation = shaderModule.entryPointInformation(entryPoint))
                    return { { shaderModule.library(), *entryPointInformation,  wgslConstantValues } };
            }
        }
    }

    auto* ast = shaderModule.ast();
    RELEASE_ASSERT(ast);

    std::optional<WGSL::PipelineLayout> wgslPipelineLayout { std::nullopt };
    if (pipelineLayout && pipelineLayout->numberOfBindGroupLayouts())
        wgslPipelineLayout = ShaderModule::convertPipelineLayout(*pipelineLayout);

    auto prepareResult = WGSL::prepare(*ast, entryPoint, wgslPipelineLayout ? &*wgslPipelineLayout : nullptr);
    if (std::holds_alternative<WGSL::Error>(prepareResult)) {
        auto wgslError = std::get<WGSL::Error>(prepareResult);
        *error = [NSError errorWithDomain:@"WebGPU" code:1 userInfo:@{ NSLocalizedDescriptionKey: wgslError.message().createNSString().get() }];
        return std::nullopt;
    }

    auto& result = std::get<WGSL::PrepareResult>(prepareResult);
    auto iterator = result.entryPoints.find(entryPoint);
    if (iterator == result.entryPoints.end())
        return std::nullopt;

    const auto& entryPointInformation = iterator->value;

    for (const auto entry : constants) {
        auto keyEntry = fromAPI(entry.key);
        auto indexIterator = entryPointInformation.specializationConstants.find(keyEntry);
        if (indexIterator == entryPointInformation.specializationConstants.end()) {
            // Per WebGPU spec: providing a value for an override declared in the
            // shader module but not statically used by this entry point is valid
            // and the value is ignored. Returning an invalid pipeline only when
            // the identifier does not refer to any override in the module.
            if (ast->containsOverride(keyEntry))
                continue;
            return { };
        }

        const auto& specializationConstant = indexIterator->value;
        switch (specializationConstant.type) {
        case WGSL::Reflection::SpecializationConstantType::Boolean: {
            bool value = entry.value;
            wgslConstantValues.set(keyEntry, value);
            break;
        }
        case WGSL::Reflection::SpecializationConstantType::Float: {
            if (entry.value < std::numeric_limits<float>::lowest() || entry.value > std::numeric_limits<float>::max())
                return std::nullopt;
            float value = entry.value;
            wgslConstantValues.set(keyEntry, value);
            break;
        }
        case WGSL::Reflection::SpecializationConstantType::Int: {
            if (entry.value < std::numeric_limits<int32_t>::min() || entry.value > std::numeric_limits<int32_t>::max())
                return std::nullopt;
            int value = entry.value;
            wgslConstantValues.set(keyEntry, value);
            break;
        }
        case WGSL::Reflection::SpecializationConstantType::Unsigned: {
            if (entry.value < 0 || entry.value > std::numeric_limits<uint32_t>::max())
                return std::nullopt;
            unsigned value = entry.value;
            wgslConstantValues.set(keyEntry, value);
            break;
        }
        case WGSL::Reflection::SpecializationConstantType::Half: {
            constexpr double halfMax = 0x1.ffcp15;
            constexpr double halfLowest = -halfMax;
            if (entry.value < halfLowest || entry.value > halfMax)
                return std::nullopt;
            WGSL::half value = entry.value;
            wgslConstantValues.set(keyEntry, value);
            break;
        }
        }
    }

    if (pipelineLayout) {
        for (unsigned i = 0; i < pipelineLayout->numberOfBindGroupLayouts(); ++i) {
            auto& wgslBindGroupLayout = wgslPipelineLayout->bindGroupLayouts[i];
            auto it = mininumBufferSizes.add(i, BufferBindingSizesForBindGroup()).iterator;
            BufferBindingSizesForBindGroup& shaderBindingSizeForBuffer = it->value;
            for (unsigned i = 0; i < wgslBindGroupLayout.entries.size(); ++i) {
                auto& wgslBindGroupLayoutEntry = wgslBindGroupLayout.entries[i];
                auto* wgslBufferBinding = std::get_if<WGSL::BufferBindingLayout>(&wgslBindGroupLayoutEntry.bindingMember);
                if (wgslBufferBinding && wgslBufferBinding->minBindingSize) {
                    auto newValue = wgslBufferBinding->minBindingSize;
                    if (auto existingValueIt = shaderBindingSizeForBuffer.find(wgslBindGroupLayoutEntry.binding); existingValueIt != shaderBindingSizeForBuffer.end())
                        newValue = std::max(newValue, existingValueIt->value);
                    shaderBindingSizeForBuffer.set(wgslBindGroupLayoutEntry.binding, newValue);
                }
            }
        }
    }

    auto generationResult = WGSL::generate(*ast, result, wgslConstantValues, WGSL::DeviceState {
        .appleGPUFamily = shaderModule.device().appleGPUFamily(),
        .shaderValidationEnabled = shaderModule.device().isShaderValidationEnabled()
    });
    if (auto* generationError = std::get_if<WGSL::Error>(&generationResult)) {
        *error = [NSError errorWithDomain:@"WebGPU" code:1 userInfo:@{ NSLocalizedDescriptionKey: generationError->message().createNSString().get() }];
        return std::nullopt;
    }
    auto& msl = std::get<String>(generationResult);

    auto library = ShaderModule::createLibrary(device, msl, label, error, WGSL::DeviceState {
        .appleGPUFamily = shaderModule.device().appleGPUFamily(),
        .shaderValidationEnabled = shaderModule.device().isShaderValidationEnabled(),
        .usesInvariant = entryPointInformation.usesInvariant
    });
    if (error && *error)
        return { };

#if !defined(NDEBUG) || (defined(ENABLE_LIBFUZZER) && ENABLE_LIBFUZZER && defined(ASAN_ENABLED) && ASAN_ENABLED)
    metalShaderSource = msl;
#else
    UNUSED_PARAM(metalShaderSource);
#endif
    return { { library, entryPointInformation, wgslConstantValues } };
}

id<MTLFunction> createFunction(id<MTLLibrary> library, const WGSL::Reflection::EntryPointInformation& entryPointInformation, NSString *label)
{
    auto functionDescriptor = [MTLFunctionDescriptor new];
    functionDescriptor.name = entryPointInformation.mangledName.createNSString().get();
    NSError *error = nil;
    id<MTLFunction> function = [library newFunctionWithDescriptor:functionDescriptor error:&error];
    if (error)
        WTFLogAlways("Function creation error: %@", error);
    function.label = label;
    return function;
}

NSString* errorValidatingBindGroup(const BindGroup& bindGroup, const BufferBindingSizesForBindGroup* mininumBufferSizes, const Vector<uint32_t>* dynamicOffsets)
{
    RefPtr bindGroupLayout = bindGroup.bindGroupLayout();
    if (!bindGroupLayout)
        return nil;

    auto& bindGroupLayoutEntries = bindGroupLayout->entries();
    for (const auto& resourceVector : bindGroup.resources()) {
        for (const auto& resource : resourceVector.resourceUsages) {
            auto bindingIndex = resource.binding;
            auto* buffer = get_if<RefPtr<Buffer>>(&resource.resource);
            if (!buffer)
                continue;

            auto it = bindGroupLayoutEntries.find(bindingIndex);
            if (it == bindGroupLayoutEntries.end())
                return [NSString stringWithFormat:@"Buffer size is missing for binding at index %u bind group", bindingIndex];

            uint64_t bufferSize = 0;
            if (auto* bufferBinding = get_if<WGPUBufferBindingLayout>(&it->value.bindingLayout))
                bufferSize = bufferBinding->minBindingSize;
            if (mininumBufferSizes) {
                if (auto bufferSizeIt = mininumBufferSizes->find(it->value.binding); bufferSizeIt != mininumBufferSizes->end()) {
                    if (bufferSize && bufferSizeIt->value > bufferSize)
                        return [NSString stringWithFormat:@"buffer size from WGSL shader(%llu) is less than the binding buffer size(%llu)", bufferSizeIt->value, bufferSize];
                    bufferSize = std::max(bufferSize, bufferSizeIt->value);
                }
            }

            if (bufferSize && buffer->get()) {
                auto dynamicOffset = bindGroup.dynamicOffset(bindingIndex, dynamicOffsets);
                auto checkedTotalOffset = checkedSum<uint64_t>(resource.entryOffset, dynamicOffset);
                if (checkedTotalOffset.hasOverflowed())
                    return [NSString stringWithFormat:@"resourceOffset(%llu) + dynamicOffset(%u) overflows uint64_t", resource.entryOffset, dynamicOffset];
                auto totalOffset = checkedTotalOffset.value();
                auto mtlBufferLength = buffer->get()->currentSize();
                if (totalOffset > mtlBufferLength || (mtlBufferLength - totalOffset) < bufferSize || bufferSize > resource.entrySize)
                    return [NSString stringWithFormat:@"buffer length(%llu) minus offset(%llu), (resourceOffset(%llu) + dynamicOffset(%u)), is less than required bufferSize(%llu)", mtlBufferLength, totalOffset, resource.entryOffset, dynamicOffset, bufferSize];
            }
        }
    }
    return nil;
}

#if !defined(NDEBUG) || (defined(ENABLE_LIBFUZZER) && ENABLE_LIBFUZZER && defined(ASAN_ENABLED) && ASAN_ENABLED)
static bool enablePsoLogging()
{
#if defined(ENABLE_LIBFUZZER) && ENABLE_LIBFUZZER && defined(ASAN_ENABLED) && ASAN_ENABLED
    return true;
#else
    return [[NSUserDefaults standardUserDefaults] boolForKey:@"WebKitWebGPULogPSOState"];
#endif
}

static StringBuilder& psoReproStringBuilder()
{
    __attribute__((no_destroy)) static thread_local StringBuilder sb;
    return sb;
}

static Vector<void (*)(int)>& existingSigabortHandlers()
{
    __attribute__((no_destroy)) static Vector<void (*)(int)> handlers;
    return handlers;
}

static String psoPreamble()
{
    return R"(
    // Compile and run with:
    //
    //  clang++ -fobjc-arc -O3 psoRepro.mm -o repro -framework Metal -fsanitize=address -framework Cocoa -std=c++20 && AGC_ENABLE_STATUS_FILE=1 FS_CACHE_SIZE=0 MTL_MONOLITHIC_COMPILER=1 ./repro
#import <Foundation/Foundation.h>
#import <Metal/Metal.h>

    static uint32_t computeAppleGPUFamily(id<MTLDevice> device)
    {
        if ([device supportsFamily:MTLGPUFamilyApple9])
            return 9;
        if ([device supportsFamily:MTLGPUFamilyApple8])
            return 8;
        if ([device supportsFamily:MTLGPUFamilyApple7])
            return 7;
        if ([device supportsFamily:MTLGPUFamilyApple6])
            return 6;
        if ([device supportsFamily:MTLGPUFamilyApple5])
            return 5;
        if ([device supportsFamily:MTLGPUFamilyApple4])
            return 4;
        return 0xFF;
    }
)"_s;
}

static void printPsoOnProgramExit(int sig)
{
    if (psoReproStringBuilder().length())
        /* NOLINT */ WTFLogAlways("// ------------------------------------------------------------------------\n// Dumping Metal repro case:\n// ------------------------------------------------------------------------\n%s\n// ------------------------------------------------------------------------\n// End of repro case\n// ------------------------------------------------------------------------", psoReproStringBuilder().toString().utf8().data());

    if (existingSigabortHandlers()[sig])
        existingSigabortHandlers()[sig](sig);
}

static bool registerPsoExitHandlers()
{
    static std::once_flag onceFlag;
    static bool handlersRegistered = false;
    std::call_once(onceFlag, [&] {
        handlersRegistered = true;
        auto sigCodes = { SIGINT, SIGILL, SIGTRAP, SIGABRT, SIGBUS, SIGSEGV };
        existingSigabortHandlers().resize(32);
        for (auto sig : sigCodes) {
            void (*prev)(int) = signal(sig, SIG_DFL);
            RELEASE_ASSERT(static_cast<size_t>(sig) < existingSigabortHandlers().size());
            existingSigabortHandlers()[sig] = prev;
            errno = 0;
            if (signal(sig, printPsoOnProgramExit) == SIG_ERR) {
                WTFLogAlways("Error: Unable to install signal handler for %d - errno %d", sig, errno); // NOLINT
                handlersRegistered = false;
            }
        }
    });

    return handlersRegistered;
}

static void printToFileForPsoRepro()
{
    NSError* error;
#if 0 /* PLATFORM(IOS_FAMILY) */
    NSURL* defaultURL = [NSURL fileURLWithPath:@"/tmp/" isDirectory:YES];
#else
    NSURL* defaultURL = [NSFileManager.defaultManager temporaryDirectory];
#endif
    NSURL* outputURL = [defaultURL URLByAppendingPathComponent:@"com.apple.WebKit"];
    BOOL directoryCreated = [NSFileManager.defaultManager createDirectoryAtURL:outputURL withIntermediateDirectories:YES attributes:nil error:&error];
    if (!directoryCreated || error) {
        WTFLogAlways("Error saving repro to %@ - %@", outputURL, error); // NOLINT
        return;
    }

    outputURL = [outputURL URLByAppendingPathComponent:@"psoRepro.mm"];
    if (FileSystem::overwriteEntireFile(outputURL.path, byteCast<uint8_t>(psoReproStringBuilder().span<Latin1Character>())))
        WTFLogAlways("Sucessfully saved repro to %@", outputURL); // NOLINT
    else
        WTFLogAlways("Error saving repro to %@ - %@", outputURL, error); // NOLINT
}

void dumpMetalReproCaseComputePSO(String&& shaderSource, String&& functionName)
{
    if (!enablePsoLogging())
        return;

    bool printToFile = !registerPsoExitHandlers();

    auto& sb = psoReproStringBuilder();
    sb.clear();
    sb.append(psoPreamble());
    /* NOLINT */ sb.append(R"(
    int main(int argc, const char * argv[])
    {
        @autoreleasepool {
        NSError *error = nil;

        // 1. Create a Metal device.
        id<MTLDevice> device = MTLCreateSystemDefaultDevice();
        if (!device) {
            NSLog(@"Metal is not supported on this device.");
            return 1;
        }

        MTLCompileOptions* options = [MTLCompileOptions new];
        options.mathMode = MTLMathModeRelaxed;
        options.mathFloatingPointFunctions = MTLMathFloatingPointFunctionsFast;
        options.preprocessorMacros = @{ @"__wgslMetalAppleGPUFamily" : [NSString stringWithFormat:@"%u", computeAppleGPUFamily(device)] };

        // 2. Load the shader source.
        NSString *shaderSource = @R"(
    )"_s); /* NOLINT */
    sb.append(shaderSource);
    sb.append(")\";"_s);
    /* NOLINT */ sb.append(R"(
    id<MTLLibrary> library = [device newLibraryWithSource:shaderSource options:options error:&error];
    if (!library || error) {
        NSLog(@"Failed to create library");
        return 1;
    }

    // 4. Create a Metal compute function.
    id<MTLFunction> computeFunction = [library newFunctionWithName:
    )"_s); /* NOLINT */
    sb.append(functionName);
    sb.append(")];"_s);
    /* NOLINT */ sb.append(R"(
    if (!computeFunction) {
        NSLog(@"Failed to create compute function.");
        return 1;
    }

    // 5. Create a Metal compute pipeline state.
    auto computePipelineDescriptor = [MTLComputePipelineDescriptor new];
    computePipelineDescriptor.computeFunction = computeFunction;
    computePipelineDescriptor.supportIndirectCommandBuffers = YES;
    id<MTLComputePipelineState> computePipelineState = [device newComputePipelineStateWithDescriptor:computePipelineDescriptor options:MTLPipelineOptionNone reflection:nil error:&error];

    if (computePipelineState)
        NSLog(@"SUCCESS");
    else
        NSLog(@"FAILED");
    }
    return 0;
    }
    )"_s); /* NOLINT */

    if (printToFile)
        printToFileForPsoRepro();
}

bool dumpMetalReproCaseRenderPSO(String&& vertexShaderSource, String&& vertexFunctionName, String&& fragmentShaderSource, String&& fragmentFunctionName, MTLRenderPipelineDescriptor* descriptor, ShaderModule::VertexStageIn& shaderLocations, const Device& device)
{
    if (!enablePsoLogging())
        return false;

    bool printToFile = !registerPsoExitHandlers();

    const auto maxVertexBuffers = device.limits().maxVertexBuffers;

    auto& sb = psoReproStringBuilder();
    sb.append(psoPreamble());
    /* NOLINT */ sb.append(R"(
    static id<MTLRenderPipelineState> makePso(id<MTLDevice> device)
    {
        MTLRenderPipelineDescriptor* mtlRenderPipelineDescriptor = [MTLRenderPipelineDescriptor new];
        MTLCompileOptions* options = [MTLCompileOptions new];
        options.mathMode = MTLMathModeRelaxed;
        options.mathFloatingPointFunctions = MTLMathFloatingPointFunctionsFast;
        options.preprocessorMacros = @{ @"__wgslMetalAppleGPUFamily" : [NSString stringWithFormat:@"%u", computeAppleGPUFamily(device)] };
        const auto& mtlColorAttachment = mtlRenderPipelineDescriptor.colorAttachments[0];

        id<MTLFunction> functionVS = nil;
        id<MTLFunction> functionFS = nil;
        NSError *error = nil;
        NSString *vertexShaderSource = @R"(
    )"_s); /* NOLINT */
    sb.append(vertexShaderSource);
    sb.append(")\";\nNSString *fragmentShaderSource = @R\"("_s);
    sb.append(fragmentShaderSource);
    sb.append(")\";"_s);
    /* NOLINT */ sb.append(R"(
    id<MTLLibrary> vertexLibrary = [device newLibraryWithSource:vertexShaderSource options:options error:&error];
    if (error)
        NSLog(@"error compiling vertex shader");

    id<MTLLibrary> fragmentLibrary = [device newLibraryWithSource:fragmentShaderSource options:options error:&error];
    if (error)
        NSLog(@"error compiling fragment shader");

    functionVS = [vertexLibrary newFunctionWithName:@")"_s); /* NOLINT */
    sb.append(vertexFunctionName);
    sb.append("\"]; functionFS = [fragmentLibrary newFunctionWithName:@\""_s);
    sb.append(fragmentFunctionName);
    /* NOLINT */ sb.append(R"("];

    mtlRenderPipelineDescriptor.vertexFunction = functionVS;
    mtlRenderPipelineDescriptor.fragmentFunction = functionFS;

    mtlRenderPipelineDescriptor.rasterSampleCount = )"_s); /* NOLINT */
    sb.append(makeString(descriptor.rasterSampleCount));
    sb.append(";\n mtlRenderPipelineDescriptor.alphaToCoverageEnabled = "_s);
    sb.append(makeString(descriptor.alphaToCoverageEnabled));
    sb.append(";\n mtlRenderPipelineDescriptor.alphaToOneEnabled = "_s);
    sb.append(makeString((int)descriptor.alphaToOneEnabled));
    sb.append(";\n mtlRenderPipelineDescriptor.rasterizationEnabled = "_s);
    sb.append(makeString((int)descriptor.rasterizationEnabled));
    sb.append(";\n mtlRenderPipelineDescriptor.maxVertexAmplificationCount = "_s);
    sb.append(makeString((unsigned)descriptor.maxVertexAmplificationCount));
    sb.append(";\n mtlRenderPipelineDescriptor.depthAttachmentPixelFormat = (MTLPixelFormat)"_s);
    sb.append(makeString((unsigned)descriptor.depthAttachmentPixelFormat));
    sb.append(";\n mtlRenderPipelineDescriptor.stencilAttachmentPixelFormat = (MTLPixelFormat)"_s);
    sb.append(makeString((unsigned)descriptor.stencilAttachmentPixelFormat));
    sb.append(";\n mtlRenderPipelineDescriptor.inputPrimitiveTopology = (MTLPrimitiveTopologyClass)"_s);
    sb.append(makeString((unsigned)descriptor.inputPrimitiveTopology));
    sb.append(";\n mtlRenderPipelineDescriptor.supportIndirectCommandBuffers = YES;\n MTLVertexDescriptor *vertexDescriptor = [MTLVertexDescriptor new];"_s);

    for (size_t i = 0; i < maxVertexBuffers; ++i) {
        if (MTLVertexBufferLayoutDescriptor* d = descriptor.vertexDescriptor.layouts[i]) {
            sb.append("{uint32_t location = "_s);
            sb.append(makeString(i));
            sb.append("; vertexDescriptor.layouts[location].stride = "_s);
            sb.append(makeString(d.stride));
            sb.append("; vertexDescriptor.layouts[location].stepFunction = (MTLVertexStepFunction)"_s);
            sb.append(d.stepFunction);
            sb.append("; vertexDescriptor.layouts[location].stepRate = "_s);
            sb.append(d.stepRate);
            sb.append(";} mtlRenderPipelineDescriptor.vertexDescriptor = vertexDescriptor; \n"_s);
        }
    }

    for (auto shaderLocation : shaderLocations.keys()) {
        if (MTLVertexAttributeDescriptor* a = descriptor.vertexDescriptor.attributes[shaderLocation]) {
            sb.append("{uint32_t shaderLocation = "_s);
            sb.append(makeString(shaderLocation));
            sb.append("; vertexDescriptor.attributes[shaderLocation].format = (MTLVertexFormat)"_s);
            sb.append(makeString((unsigned)a.format));
            sb.append("; vertexDescriptor.attributes[shaderLocation].bufferIndex = "_s);
            sb.append(makeString(a.bufferIndex));
            sb.append("; vertexDescriptor.attributes[shaderLocation].offset = "_s);
            sb.append(makeString(a.offset));
            sb.append(";}\n"_s);
        }
    }

    for (size_t i = 0; i < 8; ++i) {
        if (MTLRenderPipelineColorAttachmentDescriptor* c = descriptor.colorAttachments[i]) {
            sb.append("{uint32_t i = "_s);
            sb.append(makeString(i));
            sb.append("; MTLRenderPipelineColorAttachmentDescriptor* c = mtlRenderPipelineDescriptor.colorAttachments[i]; c.pixelFormat = (MTLPixelFormat)"_s);
            sb.append(makeString((unsigned)c.pixelFormat));
            sb.append("; c.blendingEnabled = (BOOL)"_s);
            sb.append(makeString(c.blendingEnabled));
            sb.append("; c.sourceRGBBlendFactor = (MTLBlendFactor)"_s);
            sb.append(makeString(c.sourceRGBBlendFactor));
            sb.append("; c.destinationRGBBlendFactor = (MTLBlendFactor)"_s);
            sb.append(makeString(c.destinationRGBBlendFactor));
            sb.append("; c.rgbBlendOperation = (MTLBlendOperation)"_s);
            sb.append(makeString(c.rgbBlendOperation));
            sb.append("; c.sourceAlphaBlendFactor = (MTLBlendFactor)"_s);
            sb.append(makeString(c.sourceAlphaBlendFactor));
            sb.append("; c.destinationAlphaBlendFactor = (MTLBlendFactor)"_s);
            sb.append(makeString(c.destinationAlphaBlendFactor));
            sb.append("; c.alphaBlendOperation = (MTLBlendOperation)"_s);
            sb.append(makeString(c.alphaBlendOperation));
            sb.append("; c.writeMask = (MTLColorWriteMask)"_s);
            sb.append(makeString(c.writeMask));
            sb.append(";}\n"_s);
        }
    }

    /* NOLINT */ sb.append(R"(mtlRenderPipelineDescriptor.vertexDescriptor = vertexDescriptor;
    return [device newRenderPipelineStateWithDescriptor:mtlRenderPipelineDescriptor error:&error];
    }

    int main()
    {
        auto device = MTLCreateSystemDefaultDevice();
        NSLog(@"Device is %@", [device name]);

        id<MTLRenderPipelineState> pso = makePso(device);
        if (pso)
            NSLog(@"PASS");
        else
            NSLog(@"FAIL");

        return 0;
    }
    )"_s); /* NOLINT */

    if (printToFile)
        printToFileForPsoRepro();

    return true;
}

void clearMetalPSORepro()
{
    psoReproStringBuilder().clear();
}

#endif

} // namespace WebGPU
