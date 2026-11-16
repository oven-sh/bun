// What `../macos.rs` and the files here know of each other.
#import <AppKit/AppKit.h>

typedef struct { float x, y, width, height; } BDRect;
typedef struct { float x, y, top, width, height, scale; bool isMaximized, isFullscreen, isClientDecorated; } BDGeometry;
typedef struct { uint64_t identifier; BDRect bounds, workArea; float scale, frequency; } BDDisplay;
/// `start` is -1 for none.
typedef struct { int64_t start, end; } BDRange;
typedef struct { uint8_t* start; size_t length, capacity; } BDBytes;

typedef enum : uint8_t {
    BDMouseDown, BDMouseUp, BDMouseMove, BDMouseLeave, BDScroll, BDPinch, BDDragEnter, BDDragOver, BDDrop, BDDragLeave
} BDInputKind;
typedef struct {
    BDInputKind kind;
    uint8_t button, modifiers, phase;
    /// A button is down, or the deltas are in pixels.
    bool flag;
    uint32_t clicks;
    float x, y, deltaX, deltaY;
} BDInput;

typedef enum : uint8_t {
    BDFrameIsDue, BDMoved, BDResized, BDActivated, BDDeactivated, BDVisibilityChanged, BDCloseRequested, BDWasClosed,
    BDAppearanceChanged, BDIsExamined, BDIsNotExamined
} BDWindowEvent;
typedef enum : uint8_t { BDHasJobs, BDSourceIsReady, BDWasWoken, BDTimeIsUp, BDIsAboutToWait } BDLoopEvent;

// Rust
void bd_emit(const void* json, size_t length);
void bd_trace(const char* step, double secondsSinceEvent);
void traceLaunch(const char* step);
void bd_log(const char* message);
uint32_t bun_desktop_put_blob(const void* bytes, size_t length);
BDBytes bun_desktop_take_blob(uint32_t blob);
void bun_desktop_free(BDBytes bytes);
void bd_loop_event(BDLoopEvent event);
void bd_window_event(uint32_t window, BDWindowEvent event);
/// `paths` is an array in JSON.
void bd_input(uint32_t window, const BDInput* input, const char* paths);
bool bd_accepts_first_mouse(uint32_t window, float x, float y);
void bd_raw_key(bool down, bool isRepeat, uint32_t code, uint32_t symbol, uint8_t modifiers);
bool bd_key(bool down);
void bd_key_was_taken(void);
bool bd_text_is_enabled(uint32_t window);
BDRange bd_text_range(uint32_t window, bool composing);
BDRect bd_text_caret(uint32_t window);
/// UTF-16.
BDBytes bd_text(uint32_t window, BDRange* range);
void bd_text_insert(uint32_t window, BDRange range, const char* text);
void bd_text_compose(uint32_t window, BDRange range, const char* text, BDRange selection);
void bd_text_end_composition(uint32_t window);
void bd_accessibility_action(uint64_t node, const char* action, const char* json);

#pragma GCC visibility push(hidden)

@interface BunDesktopView : NSView <NSTextInputClient, NSWindowDelegate, NSDraggingDestination>
@property (readonly) uint32_t number;
+ (BunDesktopView*)withNumber:(id)number;
@end

@interface BunDesktopTree : NSObject
- (instancetype)initWithView:(NSView*)view;
- (void)update:(NSDictionary*)tree;
@property (readonly) NSArray* roots;
@property (readonly) id focus;
- (id)at:(NSPoint)onScreen;
@end

@interface BunDesktopDelegate : NSObject <NSApplicationDelegate>
@end

id parse(const void* json, size_t length);
NSData* serialize(id value);
/// For Rust, which calls `free`: what `body` returns or throws.
char* answer(id (^body)(void));
void fail(NSString* message) __attribute__((noreturn));
void emit(NSDictionary* event);
void emitToApp(NSString* name, id value);
void reply(uint64_t number, id value);
NSData* takeBlob(id number);
NSNumber* putBlob(NSData* data);

/// `nil` for what has another type.
id member(id object, id key);
NSString* text(id value);
NSArray* list(id value);
NSNumber* number(id value);
bool isTrue(id value);
bool isFalse(id value);

/// The origin of AppKit is the bottom left corner of the first screen.
CGFloat primaryHeight(void);
/// Outside of menus and drags, and of everything that could not run again while `body` runs a loop of its own.
void commitWhatIsReady(void);
bool commitsInTime(void);
void soon(void (^body)(void));
void whenIdle(void (^body)(void));
void postEmptyEvent(void);
void cancelQuit(void);
bool hasAssistiveTechnology(void);

/// Each returns whether it knows the command.
bool menuCommand(NSString* name, id arguments, uint64_t replyNumber, id* result);
bool dialogCommand(NSString* name, id arguments, uint64_t replyNumber);
bool systemCommand(NSString* name, id arguments, uint64_t replyNumber, id* result);
void chose(id sender);
NSMenu* dockMenu(void);
void removeTrays(void);
void releaseSystem(void);
NSDictionary* systemSettings(void);
NSString* thermalState(void);

#pragma GCC visibility pop
