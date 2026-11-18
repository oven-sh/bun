// For `paint/vector/metal.rs`.
#import "bridge.h"
#import <IOSurface/IOSurfaceObjC.h>
#import <Metal/Metal.h>

typedef enum : uint32_t { BDBlend, BDOpaque, BDCount, BDCoverNonZero, BDCoverOdd, BDModes } BDMode;
typedef enum : uint32_t { BDBlends, BDHides, BDCounts, BDMixes, BDPipelines } BDPipeline;
typedef enum : uint32_t { BDColors, BDDepths, BDDepth, BDImage } BDKind;
typedef struct { int32_t left, top, right, bottom; } BDBounds;
typedef struct { BDMode mode; uint32_t mixing, texture, first, end; BDBounds clip; } BDStep;
typedef struct {
    const void *words, *units, *opaqueUnits;
    size_t wordBytes, unitBytes, opaqueBytes;
    BDStep opaque;
    const BDStep* steps;
    size_t count;
    void* const* textures;
    float backdrop[4];
    bool needsSamples, staysOpaque, loads;
} BDScene;

enum { samples = 4, unitsPerDraw = 1 << 14, flights = 3 };

static id<MTLDevice> device;
static id<MTLCommandQueue> queue;
/// Without and with samples.
static id<MTLRenderPipelineState> pipelines[2][BDPipelines];
static id<MTLDepthStencilState> tests[BDModes];
static id<MTLBuffer> corners, buffers[flights][2];
static id<MTLCommandBuffer> unfinished[flights];
static size_t flight;
/// There is no telling whose pixels are missing.
static bool hasFailed;

/// The driver keeps what the queue has needed.
void bd_vector_rest(void)
{
    @autoreleasepool {
        for (size_t it = 0; it < flights; it++) {
            [unfinished[it] waitUntilCompleted];
            unfinished[it] = nil, buffers[it][0] = buffers[it][1] = nil;
        }
        queue = nil;
    }
}

void bd_vector_stop(void)
{
    bd_vector_rest();
    @autoreleasepool {
        hasFailed = false;
        for (BDMode mode = 0; mode < BDModes; mode++)
            tests[mode] = nil;
        for (BDPipeline it = 0; it < BDPipelines; it++)
            pipelines[0][it] = pipelines[1][it] = nil;
        corners = nil, device = nil;
    }
}

char* bd_vector_start(const char* shader)
{
    return attempt(^{
        device = MTLCreateSystemDefaultDevice();
        if (!device.hasUnifiedMemory || ![device supportsFamily:MTLGPUFamilyApple3])
            fail(@"there is none, or it has memory of its own");
        NSError* error;
        id<MTLLibrary> library = [device newLibraryWithSource:@(shader) options:nil error:&error];
        if (!library)
            fail(error.description);
        MTLRenderPipelineDescriptor* descriptor = [MTLRenderPipelineDescriptor new];
        MTLRenderPipelineColorAttachmentDescriptor* color = descriptor.colorAttachments[0];
        color.pixelFormat = MTLPixelFormatBGRA8Unorm;
        color.sourceRGBBlendFactor = color.sourceAlphaBlendFactor = MTLBlendFactorOne;
        color.destinationRGBBlendFactor = MTLBlendFactorOneMinusSource1Color;
        color.destinationAlphaBlendFactor = MTLBlendFactorOneMinusSource1Alpha;
        descriptor.depthAttachmentPixelFormat = descriptor.stencilAttachmentPixelFormat = MTLPixelFormatDepth32Float_Stencil8;
        for (BDPipeline it = 0; it < BDPipelines; it++) {
            bool isPlain = it == BDHides || it == BDCounts;
            descriptor.vertexFunction = [library newFunctionWithName:isPlain ? @"place_plain_corner" : @"place_corner"];
            descriptor.fragmentFunction = [library newFunctionWithName:isPlain ? @"paint_plain_pixel" : it == BDMixes ? @"mix_pixel" : @"paint_pixel"];
            color.blendingEnabled = it == BDBlends;
            color.writeMask = it == BDCounts ? MTLColorWriteMaskNone : MTLColorWriteMaskAll;
            for (int hasSamples = it == BDCounts; hasSamples < 2; hasSamples++) {
                descriptor.rasterSampleCount = hasSamples ? samples : 1;
                if (!(pipelines[hasSamples][it] = [device newRenderPipelineStateWithDescriptor:descriptor error:&error]))
                    fail(error.description);
            }
        }
        for (BDMode mode = 0; mode < BDModes; mode++) {
            MTLDepthStencilDescriptor* test = [MTLDepthStencilDescriptor new];
            test.depthCompareFunction = mode == BDCount ? MTLCompareFunctionAlways : MTLCompareFunctionGreater;
            test.depthWriteEnabled = mode != BDCount;
            MTLStencilDescriptor *front = [MTLStencilDescriptor new], *back = front;
            if (mode == BDCount) {
                back = [MTLStencilDescriptor new];
                front.depthStencilPassOperation = MTLStencilOperationIncrementWrap;
                back.depthStencilPassOperation = MTLStencilOperationDecrementWrap;
            } else if (mode > BDCount) {
                front.stencilCompareFunction = MTLCompareFunctionNotEqual;
                front.readMask = mode == BDCoverOdd ? 1 : 255;
                front.stencilFailureOperation = front.depthFailureOperation = front.depthStencilPassOperation = MTLStencilOperationZero;
            }
            test.frontFaceStencil = front, test.backFaceStencil = back;
            tests[mode] = [device newDepthStencilStateWithDescriptor:test];
        }
        corners = [device newBufferWithLength:unitsPerDraw * 6 * sizeof(uint16_t) options:MTLResourceStorageModeShared];
        if (!corners)
            fail(@"there is no memory");
        for (uint32_t it = 0; it < unitsPerDraw * 6; it++)
            ((uint16_t*)corners.contents)[it] = it / 6 * 4 + "\0\1\2\2\1\3"[it % 6];
    });
}

void* bd_vector_texture(IOSurfaceRef surface, int32_t width, int32_t height, BDKind kind)
{
    @autoreleasepool {
        MTLPixelFormat format = surface || kind == BDColors ? MTLPixelFormatBGRA8Unorm : kind == BDImage ? MTLPixelFormatRGBA8Unorm : MTLPixelFormatDepth32Float_Stencil8;
        MTLTextureDescriptor* descriptor = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:format width:width height:height mipmapped:NO];
        descriptor.usage = MTLTextureUsageRenderTarget;
        if (surface) {
            descriptor.usage |= MTLTextureUsageShaderRead;
            descriptor.storageMode = MTLStorageModeShared;
            return (__bridge_retained void*)[device newTextureWithDescriptor:descriptor iosurface:surface plane:0];
        }
        descriptor.storageMode = kind == BDImage ? MTLStorageModePrivate : MTLStorageModeMemoryless;
        if (kind == BDImage) {
            descriptor.usage = MTLTextureUsageShaderRead;
        } else if (kind != BDDepth) {
            descriptor.textureType = MTLTextureType2DMultisample;
            descriptor.sampleCount = samples;
        }
        return (__bridge_retained void*)[device newTextureWithDescriptor:descriptor];
    }
}

static void finish(size_t which)
{
    id<MTLCommandBuffer> commands = unfinished[which];
    unfinished[which] = nil;
    [commands waitUntilCompleted];
    hasFailed |= commands && commands.status != MTLCommandBufferStatusCompleted;
    if (hasFailed)
        fail(commands.error.description ?: @"it did not complete");
}

char* bd_vector_finish(void)
{
    return attempt(^{
        for (size_t it = 0; it < flights; it++)
            finish(it);
    });
}

void bd_vector_schedule(void) { [unfinished[flight] waitUntilScheduled]; }

static id<MTLBuffer> room(size_t which, size_t length)
{
    if (buffers[flight][which].length < length)
        buffers[flight][which] = [device newBufferWithLength:length + length / 2 + 4096 options:MTLResourceStorageModeShared];
    if (!buffers[flight][which])
        fail(@"there is no memory");
    return buffers[flight][which];
}

static id<MTLCommandBuffer> begin(void)
{
    finish(flight = (flight + 1) % flights);
    queue = queue ?: [device newCommandQueue];
    return [queue commandBuffer];
}

char* bd_vector_write(void* texture, const BDBounds* area, const uint32_t* pixels, size_t stride)
{
    return attempt(^{
        id<MTLCommandBuffer> commands = begin();
        size_t width = area->right - area->left, height = area->bottom - area->top;
        id<MTLBuffer> rows = room(0, width * height * 4);
        for (size_t y = 0; y < height; y++)
            memcpy((uint32_t*)rows.contents + y * width, pixels + y * stride, width * 4);
        id<MTLBlitCommandEncoder> encoder = [commands blitCommandEncoder];
        if (!encoder)
            fail(@"there is no encoder");
        [encoder copyFromBuffer:rows sourceOffset:0 sourceBytesPerRow:width * 4 sourceBytesPerImage:width * height * 4 sourceSize:MTLSizeMake(width, height, 1)
                      toTexture:(__bridge id<MTLTexture>)texture destinationSlice:0 destinationLevel:0 destinationOrigin:MTLOriginMake(area->left, area->top, 0)];
        [encoder endEncoding];
        [commands commit];
        unfinished[flight] = commands;
    });
}

static void draw(id<MTLRenderCommandEncoder> encoder, const BDStep* step)
{
    if (step->first == step->end)
        return;
    [encoder setScissorRect:(MTLScissorRect) { step->clip.left, step->clip.top, step->clip.right - step->clip.left, step->clip.bottom - step->clip.top }];
    for (uint32_t first = step->first; first < step->end; first += unitsPerDraw) {
        [encoder setVertexBytes:&first length:sizeof first atIndex:3];
        [encoder drawIndexedPrimitives:MTLPrimitiveTypeTriangle indexCount:MIN(step->end - first, (uint32_t)unitsPerDraw) * 6
                             indexType:MTLIndexTypeUInt16 indexBuffer:corners indexBufferOffset:0];
    }
}

char* bd_vector_draw(const BDScene* scene, void* colors, void* depths, void* before, void* after)
{
    return attempt(^{
        id<MTLCommandBuffer> commands = begin();
        id<MTLBuffer> words = room(0, scene->wordBytes), units = room(1, scene->unitBytes + scene->opaqueBytes);
        memcpy(words.contents, scene->words, scene->wordBytes);
        memcpy(units.contents, scene->units, scene->unitBytes);
        memcpy((char*)units.contents + scene->unitBytes, scene->opaqueUnits, scene->opaqueBytes);
        bool hasSamples = scene->needsSamples;
        id<MTLTexture> target = (__bridge id<MTLTexture>)after;
        MTLRenderPassDescriptor* pass = [MTLRenderPassDescriptor new];
        pass.colorAttachments[0].texture = target;
        pass.colorAttachments[0].storeAction = MTLStoreActionStore;
        pass.colorAttachments[0].loadAction = scene->loads ? MTLLoadActionLoad : MTLLoadActionClear;
        pass.colorAttachments[0].clearColor = MTLClearColorMake(scene->backdrop[0], scene->backdrop[1], scene->backdrop[2], scene->backdrop[3]);
        if (hasSamples) {
            pass.colorAttachments[0].texture = (__bridge id<MTLTexture>)colors;
            pass.colorAttachments[0].resolveTexture = target;
            pass.colorAttachments[0].storeAction = MTLStoreActionMultisampleResolve;
        }
        pass.depthAttachment.texture = pass.stencilAttachment.texture = (__bridge id<MTLTexture>)depths;
        pass.depthAttachment.loadAction = pass.stencilAttachment.loadAction = MTLLoadActionClear;
        pass.depthAttachment.storeAction = pass.stencilAttachment.storeAction = MTLStoreActionDontCare;
        pass.depthAttachment.clearDepth = 0;
        id<MTLRenderCommandEncoder> encoder = [commands renderCommandEncoderWithDescriptor:pass];
        if (!encoder)
            fail(@"there is no encoder");
        struct { float size[2]; uint32_t lastTexel, staysOpaque; } settings = { { target.width, target.height }, scene->wordBytes / 4 - 1, scene->staysOpaque };
        [encoder setVertexBuffer:words offset:0 atIndex:0];
        [encoder setVertexBuffer:units offset:0 atIndex:1];
        [encoder setVertexBytes:&settings length:sizeof settings atIndex:2];
        [encoder setFragmentBytes:&settings length:sizeof settings atIndex:2];
        [encoder setFragmentBuffer:words offset:0 atIndex:0];
        [encoder setFragmentBuffer:units offset:0 atIndex:1];
        [encoder setFragmentTexture:(__bridge id<MTLTexture>)before atIndex:0];
        [encoder setFragmentTexture:(__bridge id<MTLTexture>)before atIndex:1];
        BDMode mode = BDModes;
        uint32_t mixing = 0, texture = 0;
        if (scene->opaqueBytes) {
            [encoder setRenderPipelineState:pipelines[hasSamples][BDHides]];
            [encoder setDepthStencilState:tests[BDOpaque]];
            draw(encoder, &scene->opaque);
        }
        for (const BDStep* step = scene->steps; step < scene->steps + scene->count; step++) {
            if (mode != step->mode || mixing != step->mixing) {
                mode = step->mode, mixing = step->mixing;
                [encoder setRenderPipelineState:pipelines[hasSamples][mode == BDCount ? BDCounts : mixing ? BDMixes : BDBlends]];
                [encoder setDepthStencilState:tests[mode]];
                if (mixing)
                    [encoder setFragmentBytes:&mixing length:sizeof mixing atIndex:3];
            }
            if (step->texture && step->texture != texture)
                [encoder setFragmentTexture:(__bridge id<MTLTexture>)scene->textures[(texture = step->texture) - 1] atIndex:1];
            draw(encoder, step);
        }
        [encoder endEncoding];
        [commands commit];
        unfinished[flight] = commands;
    });
}
