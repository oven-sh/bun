import { mount, unmount } from "svelte";
import App from "./App.svelte";

declare global {
  var didMount: boolean | undefined;
  var hljs: any;
}

let app: Record<string, any> | undefined;

// mount the application entrypoint to the DOM on first load. On subsequent hot
// updates, the app will be unmounted and re-mounted via the accept handler.

const root = document.getElementById("root")!;
if (!globalThis.didMount) {
  app = mount(App, { target: root });
}
globalThis.didMount = true;

if (import.meta.hot) {
  import.meta.hot.accept(async () => {
    // avoid unmounting twice when another update gets accepted while outros are playing
    if (!app) return;
    const prevApp = app;
    app = undefined;
    await unmount(prevApp, { outro: true });
    app = mount(App, { target: root });
  });
}
