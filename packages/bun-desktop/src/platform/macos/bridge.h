// What `../macos.rs` and the files here know of each other.
#import <AppKit/AppKit.h>

#import "protocol.h"

/// `start` is -1 for none.
typedef struct {
  int64_t start, end;
} BDRange;

typedef enum : uint8_t {
  BDMouseDown,
  BDMouseUp,
  BDMouseMove,
  BDMouseLeave,
  BDScroll,
  BDPinch,
  BDDragEnter,
  BDDragOver,
  BDDrop,
  BDDragLeave
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
  BDFrameIsDue,
  BDMoved,
  BDResized,
  BDActivated,
  BDDeactivated,
  BDVisibilityChanged,
  BDCloseRequested,
  BDWasClosed,
  BDAppearanceChanged,
  BDIsExamined,
  BDIsNotExamined
} BDReport;
typedef enum : uint8_t {
  BDHasJobs,
  BDSourceIsReady,
  BDWasWoken,
  BDTimeIsUp,
  BDIsAboutToWait
} BDLoopEvent;

typedef struct {
  uint64_t node;
  uint32_t offset, isUpstream;
} BDMarker;
typedef enum : uint8_t {
  BDNothing,
  BDNumber,
  BDTwoNumbers,
  BDSpan,
  BDSpot,
  BDArea,
  BDString,
  BDElement,
  BDOneMarker,
  BDTwoMarkers,
  BDReplacement,
  BDSearch
} BDParameterKind;
typedef struct {
  BDParameterKind kind;
  double numbers[4];
  BDMarker markers[2];
  const char *text, *keys;
} BDParameter;
typedef enum : uint8_t {
  BDAttributes,
  BDParameterizedAttributes,
  BDActions
} BDNameKind;
typedef enum : uint8_t { BDPlain, BDLink, BDAttributed } BDTextKind;
typedef enum : uint8_t { BDFrame, BDOrigin, BDExtent } BDPlaceKind;

// Rust
/// For the elements of a list, which are all zeros.
void *bd_allocate(size_t count, size_t size);
void bd_free_units(BDListu16 units);
// These take over what the argument has.
void bd_emit(const BDSystemEvent *event);
void bd_emit_to_window(uint32_t window, const BDWindowEvent *event);
void bd_reply(uint32_t number, const BDReply *reply);
void bd_accessibility_clients(bool isEnhanced, bool hasScreenReader);
/// With a window, it waits for the trees that are missing.
void bd_accessibility_was_used(uint32_t window);
uint32_t bd_accessibility_window(uint64_t node);
bool bd_accessibility_is_settable(uint64_t node, const char *name);
bool bd_accessibility_set(uint64_t node, const char *name,
                          const BDParameter *to);
void bd_accessibility_act(uint64_t node, const char *name);
/// These return retained objects.
void *bd_accessibility_roots(uint32_t window);
void *bd_accessibility_focus(uint32_t window);
void *bd_accessibility_hit(uint32_t window, uint64_t within, float x, float y);
void *bd_accessibility_custom_description(uint64_t node);
void *bd_accessibility_names(uint64_t node, BDNameKind kind);
void *bd_accessibility_value(uint64_t node, const char *name,
                             const BDParameter *parameter);
void bd_trace(const char *step, double secondsSinceEvent);
void traceLaunch(const char *step);
void bd_log(const char *message);
void bd_loop_event(BDLoopEvent event);
void bd_window_event(uint32_t window, BDReport event);
void bd_input(uint32_t window, const BDInput *input, BDListText paths);
bool bd_accepts_first_mouse(uint32_t window, float x, float y);
void bd_raw_key(bool down, bool isRepeat, uint32_t code, uint32_t symbol,
                uint8_t modifiers);
bool bd_key(bool down);
void bd_key_was_taken(void);
bool bd_text_is_enabled(uint32_t window);
bool bd_text_is_secret(uint32_t window);
BDRange bd_text_range(uint32_t window, bool composing);
BDRect bd_text_caret(uint32_t window);
BDListu16 bd_text(uint32_t window, BDRange *range);
void bd_text_insert(uint32_t window, BDRange range, const char *text);
void bd_text_compose(uint32_t window, BDRange range, const char *text,
                     BDRange selection);
void bd_text_end_composition(uint32_t window);

BDSystemSettings bd_settings(void);

#pragma GCC visibility push(hidden)

@interface BunDesktopView : NSView <NSTextInputClient, NSWindowDelegate,
                                    NSDraggingDestination, NSDraggingSource>
@property(readonly) uint32_t number;
+ (BunDesktopView *)withNumber:(uint32_t)number;
@property(nonatomic) bool hasMenu;
@end

@interface BunDesktopApplication : NSApplication
- (void)watchForScreenReaders;
@end

@interface BunDesktopDelegate
    : NSObject <NSApplicationDelegate, NSUserActivityDelegate>
@end

/// For Rust, which calls `free`: what `body` throws, or null.
char *attempt(void (^body)(void));
void fail(NSString *message) __attribute__((noreturn));
#define emit(...) bd_emit(&(BDSystemEvent){__VA_ARGS__})
#define reply(number, ...) bd_reply(number, &(BDReply){__VA_ARGS__})
#define listOf(type, count)                                                    \
  ((BDList##type){bd_allocate(count, sizeof(BD##type)), count, count})
#define forEach(it, list)                                                      \
  for (__typeof__(*(list).start) *it = (list).start;                           \
       it < (list).start + (list).length; it++)

NSString *string(BDText text);
/// `nil` if it is empty.
NSString *stringIfAny(BDText text);
NSArray<NSString *> *strings(BDListText texts);
NSData *dataIfAny(BDListu8 bytes);
BDText textOf(NSString *string);
BDListText textsOf(NSArray<NSString *> *strings);
BDListu8 bytesOf(NSData *data);

/// The origin of AppKit is the bottom left corner of the first screen.
CGFloat primaryHeight(void);
/// Outside of menus and drags, and of everything that could not run again while
/// `body` runs a loop of its own.
void soon(void (^body)(void));
void whenIdle(void (^body)(void));
void giveFocusBack(NSWindow *window);
void displaysChanged(void);
void postEmptyEvent(void);
void cancelQuit(void);
id accessibleAt(uint32_t window, uint64_t within, NSPoint onScreen);

/// For a framework that few apps need. Linking it would slow down every launch.
Class classIn(NSString *framework, NSString *name);
NSImage *imageOf(BDIcon icon);
uint32_t rgba(NSColor *color);
NSTouchBar *touchBar(BDListTouchBarItem items, BDListTouchBarItem escape);
void updateTouchBarItem(const BDTouchBarItem *from);
void trustCertificate(const BDSystemRequest *request, uint32_t replyNumber);
/// Other processes do not get to see what is typed into a password field.
void updateSecureInput(void);
void menuCommand(const BDSystemCommand *command);
void popUpMenu(const BDSystemRequest *request, uint32_t replyNumber);
void pickFiles(const BDFilePicker *options, uint32_t replyNumber);
void showMessage(const BDMessageBox *options, uint32_t replyNumber);
void closeMessage(uint32_t identifier);
void print(const BDPrintJob *job, uint32_t replyNumber);
void chose(id sender);
NSMenu *dockMenu(void);
void removeTrays(void);
void releaseSystem(void);
BDThermalState thermalState(void);

#pragma GCC visibility pop
