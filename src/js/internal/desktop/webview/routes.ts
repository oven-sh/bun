// Which methods of a `WebContents` go to the web engine while its page is there.
const split = (names: string) => names.split(/\s+/);

function install(prototype: object, kPrivate: symbol) {
  function route(names: string, remote: (guest: any, name: string, args: any[]) => unknown, starts = false) {
    for (const name of split(names)) {
      const local = prototype[name];
      prototype[name] = function (...args: unknown[]) {
        const guest = starts ? this[kPrivate].startGuest() : this[kPrivate].guest;
        return guest ? remote(guest, name, args) : local?.$apply(this, args);
      };
    }
  }
  route(
    `executeJavaScript executeJavaScriptInIsolatedWorld getPrintersAsync insertCSS insertText printToPDF
    removeInsertedCSS savePage setVisualZoomLevelLimits takeHeapSnapshot`,
    (guest, name, args) => guest.perform(name, ...args),
    true,
  );
  route(
    `adjustSelection centerSelection closeDevTools copyImageAt downloadURL forcefullyCrashRenderer
    inspectElement invalidate reload reloadIgnoringCache replace replaceMisspelling
    scrollToBottom scrollToTop stop stopFindInPage`,
    (guest, name, args) => guest.tell(name, ...args),
  );
  route("copy cut delete paste pasteAndMatchStyle redo selectAll undo unselect", (guest, name) =>
    guest.view.edit(name),
  );
  route("openDevTools toggleDevTools", (guest, name, [options]) => guest.tell(name, { ...options, mode: "detach" }));
  route("beginFrameSubscription", (guest, _, args) => guest.subscribe(args.at(-1)), true);
  route("endFrameSubscription", guest => void (guest.onFrame = undefined));
  route("capturePage", (guest, _, args) => guest.capture(args), true);
  route("findInPage", (guest, _, args) => guest.findInPage(...args));
  route("print", (guest, _, [options, callback]) => {
    guest.tell("print", options);
    callback?.(true, "");
  });
  route(
    "isCrashed isCurrentlyAudible isDevToolsOpened isLoading isLoadingMainFrame isWaitingForResponse",
    (guest, name) => !!guest.mirrored[name],
  );
  route("getTitle", guest => guest.mirrored.title ?? "");
  route("getURL", guest => guest.mirrored.url ?? "");
  route("getOSProcessId", guest => guest.mirrored.pid ?? 0);
  route("getProcessId", guest => guest.mainFrame?.processId ?? 0);
  route("getZoomLevel", guest => guest.mirrored.zoomLevel ?? 0);
  route("sendToFrame", (guest, _, [id, ...message]) => {
    const [routingId, processId = guest.mainFrame?.processId] = [id].flat().reverse();
    const frame = guest.frames.find(it => it.routingId === routingId && it.processId === processId);
    frame?.send(...message);
    return !!frame;
  });

  const settings = `disableDeviceEmulation enableDeviceEmulation setAudioMuted setBackgroundThrottling
    setCaretBrowsingEnabled setFrameRate setImageAnimationPolicy setUserAgent setWebRTCIPHandlingPolicy
    setWebRTCUDPPortRange setZoomLevel setZoomMode`;
  for (const name of split(settings)) {
    const local = prototype[name];
    prototype[name] = function (...args: unknown[]) {
      local.$apply(this, args);
      const { guest, settings } = this[kPrivate];
      settings.delete(name);
      settings.set(name, args);
      guest?.set(name, args);
    };
  }
  prototype["getWebRTCIPHandlingPolicy"] = function () {
    return this[kPrivate].settings.get("setWebRTCIPHandlingPolicy")?.[0] ?? "default";
  };
}

export default { install };
