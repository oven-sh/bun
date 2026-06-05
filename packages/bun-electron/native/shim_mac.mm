// macOS support for the bun-electron shim.
//
// Chromium's browser process expects NSApp to be an NSApplication subclass
// conforming to CefAppProtocol. Bun is a plain CLI executable, so the shim
// installs one before CefInitialize runs (called from be_init).

#import <Cocoa/Cocoa.h>

#include "include/cef_application_mac.h"

@interface BunElectronApplication : NSApplication <CefAppProtocol> {
 @private
  BOOL handlingSendEvent_;
}
@end

@implementation BunElectronApplication

- (BOOL)isHandlingSendEvent {
  return handlingSendEvent_;
}

- (void)setHandlingSendEvent:(BOOL)handlingSendEvent {
  handlingSendEvent_ = handlingSendEvent;
}

- (void)sendEvent:(NSEvent*)event {
  CefScopedSendingEvent sendingEventScoper;
  [super sendEvent:event];
}

@end

extern "C" void be_mac_init_application(void) {
  @autoreleasepool {
    // Instantiates NSApp as our subclass; must happen before any other
    // NSApplication use in the process.
    [BunElectronApplication sharedApplication];
    // CLI processes default to "prohibited", which prevents windows from
    // appearing or taking focus.
    [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
    [NSApp activateIgnoringOtherApps:YES];
  }
}
