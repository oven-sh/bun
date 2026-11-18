// For `paint/layers`: surfaces, the layers that show them, and the GPU that draws on them.
#import "bridge.h"
#import <IOSurface/IOSurfaceObjC.h>
#import <Metal/Metal.h>
#import <QuartzCore/QuartzCore.h>
#import <dlfcn.h>
#import <sys/event.h>

void bd_release(void* object) { CFRelease(object); }

void* bd_surface_create(int32_t width, int32_t height)
{
    @autoreleasepool {
        IOSurface* surface = [[IOSurface alloc] initWithProperties:@{
            IOSurfacePropertyKeyWidth : @(width),
            IOSurfacePropertyKeyHeight : @(height),
            IOSurfacePropertyKeyBytesPerElement : @4,
            IOSurfacePropertyKeyBytesPerRow : @((width * 4 + 63) & ~63),
            IOSurfacePropertyKeyPixelFormat : @((OSType)'BGRA'),
        }];
        if (surface)
            IOSurfaceSetValue((__bridge IOSurfaceRef)surface, kIOSurfaceColorSpace, kCGColorSpaceSRGB);
        return (__bridge_retained void*)surface;
    }
}

bool bd_surface_is_in_use(IOSurfaceRef surface) { return IOSurfaceIsInUse(surface); }

/// For a layer. The window server keeps what it has set up for the surface as long as this exists.
void* bd_surface_contents(IOSurfaceRef surface)
{
    static CFTypeRef (*create)(IOSurfaceRef);
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        create = dlsym(RTLD_DEFAULT, "CAIOSurfaceCreate");
    });
    return (void*)((create ? create(surface) : NULL) ?: CFRetain(surface));
}

static __weak IOSurface* replaced;
void bd_surface_was_replaced(void* surface) { replaced = (__bridge IOSurface*)surface; }
bool windowServerIsBusy(void) { return replaced.isInUse; }

/// With the GPU, so that there is nothing to fetch.
static const bool sharesMemory = TARGET_CPU_ARM64;

void* bd_surface_lock(IOSurfaceRef surface, bool writes, size_t* bytesPerRow)
{
    if (writes || !sharesMemory)
        IOSurfaceLock(surface, writes ? 0 : kIOSurfaceLockReadOnly, NULL);
    *bytesPerRow = IOSurfaceGetBytesPerRow(surface);
    return IOSurfaceGetBaseAddress(surface);
}

void bd_surface_unlock(IOSurfaceRef surface, bool wrote)
{
    if (wrote || !sharesMemory)
        IOSurfaceUnlock(surface, wrote ? 0 : kIOSurfaceLockReadOnly, NULL);
}

void* bd_layer_create(void* parent)
{
    @autoreleasepool {
        CALayer* layer = [CALayer new];
        NSArray* keys = @[ @"anchorPoint", @"backgroundColor", @"bounds", @"cornerRadius", @"masksToBounds", @"opacity", @"contents", @"contentsScale", @"onOrderIn", @"onOrderOut", @"position", @"sublayers", @"zPosition" ];
        NSMutableDictionary* actions = [NSMutableDictionary new];
        for (NSString* key in keys)
            actions[key] = NSNull.null;
        layer.actions = actions;
        layer.anchorPoint = CGPointZero;
        layer.edgeAntialiasingMask = 0;
        [(__bridge CALayer*)parent addSublayer:layer];
        return (__bridge_retained void*)layer;
    }
}

/// Moves `corner` to the top left of its parent. Returns whether `y` grows downwards there.
bool bd_layer_pin(void* corner)
{
    CALayer *layer = (__bridge CALayer*)corner, *root = layer.superlayer;
    bool isFlipped = root.contentsAreFlipped;
    CGPoint position = CGPointMake(0, isFlipped ? 0 : root.bounds.size.height);
    if (!CGPointEqualToPoint(layer.position, position))
        layer.position = position;
    return isFlipped;
}

void bd_layer_place(void* pointer, double x, double y, double width, double height, double scale, bool isOpaque)
{
    CALayer* layer = (__bridge CALayer*)pointer;
    layer.frame = CGRectMake(x, y, width, height);
    layer.contentsScale = scale;
    layer.opaque = isOpaque;
}

void bd_layer_show(void* layer, void* surface) { ((__bridge CALayer*)layer).contents = (__bridge id)surface; }

void bd_surface_make_wide(void* surface) { IOSurfaceSetValue(surface, kIOSurfaceColorSpace, kCGColorSpaceDisplayP3); }

void bd_layer_blink(void* pointer, uint32_t rgba, double secondsAgo, bool blinks)
{
    @autoreleasepool {
        CALayer* layer = (__bridge CALayer*)pointer;
        CGColorRef color = CGColorCreateSRGB((rgba >> 24) / 255., (rgba >> 16 & 255) / 255., (rgba >> 8 & 255) / 255., (rgba & 255) / 255.);
        layer.backgroundColor = color;
        CGColorRelease(color);
        layer.opaque = NO;
        layer.zPosition = 1e7;
        if (!blinks)
            return [layer removeAnimationForKey:@"blinking"];
        CAKeyframeAnimation* blinking = [CAKeyframeAnimation animationWithKeyPath:@"opacity"];
        blinking.calculationMode = kCAAnimationDiscrete;
        blinking.values = @[ @1, @0 ];
        blinking.keyTimes = @[ @0, @0.5, @1 ];
        blinking.duration = 1;
        blinking.repeatCount = HUGE_VALF;
        blinking.beginTime = CACurrentMediaTime() - secondsAgo;
        [layer addAnimation:blinking forKey:@"blinking"];
    }
}

void bd_layer_clip(void* pointer, double radius, bool isSmooth, float opacity, double order)
{
    CALayer* layer = (__bridge CALayer*)pointer;
    layer.opaque = NO;
    layer.masksToBounds = YES;
    layer.cornerRadius = radius;
    layer.cornerCurve = isSmooth ? kCACornerCurveContinuous : kCACornerCurveCircular;
    layer.opacity = opacity;
    layer.zPosition = order;
}

void bd_layer_center(void* pointer, double x, double y, double width, double height, double scale)
{
    CALayer* layer = (__bridge CALayer*)pointer;
    layer.anchorPoint = CGPointMake(0.5, 0.5);
    layer.bounds = CGRectMake(0, 0, width, height);
    layer.position = CGPointMake(x, y);
    layer.contentsScale = scale;
}

/// A sample is a position and an opacity or a matrix.
void bd_layer_animate(void* pointer, bool fades, const double* samples, size_t count, double secondsAgo, double cycle, double cycles)
{
    @autoreleasepool {
        NSString* key = fades ? @"opacity" : @"transform";
        if (!count)
            return [(__bridge CALayer*)pointer removeAnimationForKey:key];
        NSMutableArray *times = [NSMutableArray new], *values = [NSMutableArray new];
        for (const double* it = samples; count--; it += fades ? 2 : 7) {
            CGAffineTransform matrix = fades ? CGAffineTransformIdentity : CGAffineTransformMake(it[1], it[2], it[3], it[4], it[5], it[6]);
            id value = fades ? @(fmax(0, fmin(it[1], 1))) : [NSValue valueWithCATransform3D:CATransform3DMakeAffineTransform(matrix)];
            if (!times.count && it[0] > 0) {
                [times addObject:@0];
                [values addObject:value];
            }
            [times addObject:@(fmax(0, fmin(it[0], 1)))];
            [values addObject:value];
            if (!count && it[0] < 1) {
                [times addObject:@1];
                [values addObject:value];
            }
        }
        CAKeyframeAnimation* animation = [CAKeyframeAnimation animationWithKeyPath:key];
        animation.values = values;
        animation.keyTimes = times;
        animation.duration = cycle;
        animation.repeatCount = MIN(cycles, HUGE_VALF);
        animation.beginTime = CACurrentMediaTime() - secondsAgo;
        animation.fillMode = kCAFillModeBoth;
        animation.removedOnCompletion = NO;
        if (fades || cycle * cycles > 1)
            animation.preferredFrameRateRange = (CAFrameRateRange) { 30, 60, 60 };
        [(__bridge CALayer*)pointer addAnimation:animation forKey:key];
    }
}

void bd_layer_set_opaque(void* layer, bool isOpaque) { ((__bridge CALayer*)layer).opaque = isOpaque; }
void bd_layer_remove(void* layer) { [(__bridge CALayer*)layer removeFromSuperlayer]; }

CFTimeInterval commitsFrom, waitedToCommit;

/// Other timers are put off by several frames in a process that the system takes for unimportant.
void bd_layers_wait(void)
{
    static int timers;
    CFTimeInterval left = commitsFrom - CACurrentMediaTime();
    if (left <= 0)
        return;
    waitedToCommit = left;
    timers = timers ?: kqueue();
    struct kevent64_s timer = { .filter = EVFILT_TIMER, .flags = EV_ADD | EV_ONESHOT, .fflags = NOTE_NSECONDS | NOTE_CRITICAL, .data = left * 1e9 + 1 };
    if (kevent64(timers, &timer, 1, &timer, 1, 0, NULL) != 1 || timer.flags & EV_ERROR)
        [NSThread sleepForTimeInterval:commitsFrom - CACurrentMediaTime()];
}

void bd_layers_flush(void)
{
    @autoreleasepool {
        [CATransaction flush];
    }
}

static id<MTLDevice> device;

/// A pixel that gets to know when it is on the screen.
void* bd_witness_create(void* parent)
{
    @autoreleasepool {
        CAMetalLayer* layer = [CAMetalLayer new];
        layer.device = device ?: MTLCreateSystemDefaultDevice();
        layer.presentsWithTransaction = YES;
        layer.opaque = NO;
        layer.anchorPoint = CGPointZero;
        layer.drawableSize = CGSizeMake(1, 1);
        [(__bridge CALayer*)parent addSublayer:layer];
        return (__bridge_retained void*)layer;
    }
}

/// `tell` gets seconds. A display that is not real does not know when it shows something, which leaves the time of the news.
void bd_witness_present(void* layer, void (*tell)(double shownAt, double delay))
{
    @autoreleasepool {
        id<CAMetalDrawable> drawable = ((__bridge CAMetalLayer*)layer).nextDrawable;
        CFTimeInterval paintedAt = CACurrentMediaTime();
        [drawable addPresentedHandler:^(id<MTLDrawable> it) {
            CFTimeInterval shownAt = it.presentedTime ?: CACurrentMediaTime();
            tell(shownAt, it.presentedTime ? shownAt - paintedAt : 0);
        }];
        [drawable present];
    }
}

static id<MTLCommandQueue> queue;
static id<MTLRenderPipelineState> pipeline;

char* bd_gpu_start(const char* shader)
{
    return attempt(^{
        device = device ?: MTLCreateSystemDefaultDevice();
        // One that has failed ignores what it is given.
        queue = nil;
        if (!device.hasUnifiedMemory || ![device supportsFamily:MTLGPUFamilyApple1])
            fail(@"there is none, or it has memory of its own");
        NSError* error;
        id<MTLLibrary> library = [device newLibraryWithSource:@(shader) options:nil error:&error];
        if (!library)
            fail(error.description);
        MTLRenderPipelineDescriptor* descriptor = [MTLRenderPipelineDescriptor new];
        descriptor.vertexFunction = [library newFunctionWithName:@"place"];
        descriptor.fragmentFunction = [library newFunctionWithName:@"paint"];
        MTLRenderPipelineColorAttachmentDescriptor* color = descriptor.colorAttachments[0];
        color.pixelFormat = MTLPixelFormatBGRA8Unorm;
        color.blendingEnabled = YES;
        color.sourceRGBBlendFactor = color.sourceAlphaBlendFactor = MTLBlendFactorOne;
        color.destinationRGBBlendFactor = color.destinationAlphaBlendFactor = MTLBlendFactorOneMinusSourceAlpha;
        pipeline = [device newRenderPipelineStateWithDescriptor:descriptor error:&error];
        if (!pipeline)
            fail(error.description);
    });
}

/// Around whole pages, or with memory of its own if `start` is null.
void* bd_gpu_buffer(void* start, size_t length)
{
    id<MTLBuffer> buffer = start ? [device newBufferWithBytesNoCopy:start length:length options:MTLResourceStorageModeShared deallocator:nil]
                                 : [device newBufferWithLength:length options:MTLResourceStorageModeShared];
    return (__bridge_retained void*)buffer;
}

void bd_gpu_rest(void) { queue = nil; }
void* bd_gpu_contents(void* buffer) { return ((__bridge id<MTLBuffer>)buffer).contents; }

void* bd_gpu_texture(IOSurfaceRef surface)
{
    @autoreleasepool {
        MTLTextureDescriptor* descriptor = [MTLTextureDescriptor texture2DDescriptorWithPixelFormat:MTLPixelFormatBGRA8Unorm
                                                                                              width:IOSurfaceGetWidth(surface)
                                                                                             height:IOSurfaceGetHeight(surface)
                                                                                          mipmapped:NO];
        descriptor.usage = MTLTextureUsageRenderTarget;
        descriptor.storageMode = MTLStorageModeShared;
        return (__bridge_retained void*)[device newTextureWithDescriptor:descriptor iosurface:surface plane:0];
    }
}

typedef struct { size_t offset, count; void* slots[8]; } BDBatch;
typedef struct { void* texture; float cell[4]; size_t batches; } BDPass;

static id<MTLCommandBuffer> unfinished;

char* bd_gpu_finish(void)
{
    return attempt(^{
        id<MTLCommandBuffer> commands = unfinished;
        unfinished = nil;
        [commands waitUntilCompleted];
        if (commands && commands.status != MTLCommandBufferStatusCompleted)
            fail(commands.error.description ?: @"it did not complete");
    });
}

/// From when it returns, the window server only gets to read the surfaces after they were drawn on.
char* bd_gpu_draw(void* instances, const BDPass* passes, size_t count, const BDBatch* batches)
{
    return attempt(^{
        id<MTLBuffer> all = (__bridge id<MTLBuffer>)instances;
        queue = queue ?: [device newCommandQueue];
        id<MTLCommandBuffer> commands = [queue commandBuffer];
        const BDBatch* batch = batches;
        for (const BDPass* pass = passes; pass < passes + count; pass++) {
            MTLRenderPassDescriptor* descriptor = [MTLRenderPassDescriptor new];
            descriptor.colorAttachments[0].texture = (__bridge id<MTLTexture>)pass->texture;
            descriptor.colorAttachments[0].loadAction = MTLLoadActionClear;
            descriptor.colorAttachments[0].clearColor = MTLClearColorMake(0, 0, 0, 0);
            descriptor.colorAttachments[0].storeAction = MTLStoreActionStore;
            id<MTLRenderCommandEncoder> encoder = [commands renderCommandEncoderWithDescriptor:descriptor];
            if (!encoder)
                fail(@"there is no encoder");
            [encoder setRenderPipelineState:pipeline];
            [encoder setVertexBytes:pass->cell length:sizeof pass->cell atIndex:1];
            [encoder setFragmentBytes:pass->cell length:sizeof pass->cell atIndex:1];
            for (const BDBatch* end = batch + pass->batches; batch < end; batch++) {
                [encoder setVertexBuffer:all offset:batch->offset atIndex:0];
                [encoder setFragmentBuffer:all offset:batch->offset atIndex:0];
                [encoder setFragmentBuffers:(__unsafe_unretained id<MTLBuffer> const*)(void*)batch->slots offsets:(NSUInteger[8]) { 0 } withRange:NSMakeRange(2, 8)];
                [encoder drawPrimitives:MTLPrimitiveTypeTriangleStrip vertexStart:0 vertexCount:4 instanceCount:batch->count];
            }
            [encoder endEncoding];
        }
        [commands commit];
        [commands waitUntilScheduled];
        unfinished = commands;
    });
}
