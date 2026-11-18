// What the console has besides the globals. `host` gets the name of what is wanted and the arguments.
host => {
  "use strict";
  const monitored = {
    mouse:
      "auxclick click dblclick mousedown mouseenter mouseleave mousemove mouseout mouseover mouseup pointerdown pointerup wheel",
    key: "keydown keyup keypress textInput",
    touch: "touchstart touchmove touchend touchcancel",
    pointer: "pointerover pointerout pointerenter pointerleave pointerdown pointerup pointermove pointercancel",
    control: "resize scroll zoom focus blur select input change submit reset",
  };
  const log = event => console.log(event.type, event);
  const typesOf = (types = [...Object.keys(monitored), "load", "unload", "abort", "error"]) =>
    [types].flat().flatMap(it => monitored[it]?.split(" ") ?? it);
  const helpers = () => ({
    __proto__: null,
    $: (selector, root = document) => root.querySelector(selector),
    $$: (selector, root = document) => [...root.querySelectorAll(selector)],
    $x(path, root = document) {
      const found = document.evaluate(path, root, null, XPathResult.ANY_TYPE, null);
      if (found.resultType === XPathResult.NUMBER_TYPE) return found.numberValue;
      if (found.resultType === XPathResult.STRING_TYPE) return found.stringValue;
      if (found.resultType === XPathResult.BOOLEAN_TYPE) return found.booleanValue;
      const all = [];
      for (let it; (it = found.iterateNext());) all.push(it);
      return all;
    },
    keys: object => Object.keys(object),
    values: object => Object.values(object),
    clear: () => console.clear(),
    dir: (...data) => console.dir(...data),
    dirxml: (...data) => console.dirxml(...data),
    table: (...data) => console.table(...data),
    copy: value => host("copy", value),
    inspect: value => host("inspect", value),
    getEventListeners(target) {
      const all = {};
      for (const it of host("listeners", target)) (all[it.type] ??= []).push(it);
      return all;
    },
    monitorEvents: (target, types) => typesOf(types).forEach(it => target.addEventListener(it, log)),
    unmonitorEvents: (target, types) => typesOf(types).forEach(it => target.removeEventListener(it, log)),
    get $_() {
      return host("$_");
    },
    get $0() {
      return host("$0");
    },
    get $1() {
      return host("$1");
    },
    get $2() {
      return host("$2");
    },
    get $3() {
      return host("$3");
    },
    get $4() {
      return host("$4");
    },
  });
  // What the page has under one of these names comes first. No function that it can replace gets them.
  return () => {
    const free = helpers();
    for (const name in free) if (name in globalThis) delete free[name];
    return free;
  };
};
