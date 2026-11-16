// The modules of `dom/`. The realm of a frame uses those of the first window of its origin.
let shared: ((name: string) => any) | undefined;

export default {
  share(modules: (name: string) => any) {
    shared = modules;
  },
  get core() {
    return shared ? shared("core") : require("internal/desktop/dom/core");
  },
  get cssom() {
    return shared ? shared("cssom") : require("internal/desktop/dom/cssom");
  },
  get document() {
    return shared ? shared("document") : require("internal/desktop/dom/document");
  },
  get events() {
    return shared ? shared("events") : require("internal/desktop/dom/events");
  },
  get forms() {
    return shared ? shared("forms") : require("internal/desktop/dom/forms");
  },
  get geometry() {
    return shared ? shared("geometry") : require("internal/desktop/dom/geometry");
  },
  get loader() {
    return shared ? shared("loader") : require("internal/desktop/dom/loader");
  },
  get node() {
    return shared ? shared("node") : require("internal/desktop/dom/node");
  },
  get parser() {
    return shared ? shared("parser") : require("internal/desktop/dom/parser");
  },
};
