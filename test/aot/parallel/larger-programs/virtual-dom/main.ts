// Elements as values, components with state and effects, keyed differences applied to a tree of nodes, events that bubble, a renderer to text, in two modules
import { Component, FRAGMENT, h, DomEvent, DomNode, Hooks, Root } from "./lib";
const {
  useEffect, useMemo, useReducer, useRef, useState
} = Hooks;
const log: string[] = [];
interface Item {
  id: number;
  title: string;
  done: boolean
}
type Action = {
  type: "add";
  title: string
} | {
  type: "toggle";
  id: number
} | {
  type: "remove";
  id: number
} | {
  type: "sort"
};
const Row: Component<{
  item: Item;
  send: (a: Action) => void
}
> = ({ item, send }) => {
  const [n, set] = useState(0);
  const renders = useRef(0);
  renders.current++;
  useEffect(() => {
    log.push("mount " + item.id);
    return () => {
      log.push("unmount " + item.id);
  };
}, []);
  return h("li", { class: item.done ? "done" : null, onClick: (e: DomEvent) => {
    set(v => v + 1);
    if (e.detail === "toggle") send({ type: "toggle", id: item.id });
    if (e.detail === "remove") {
      e.stopped = true;
      send({ type: "remove", id: item.id });
    }
  }
}, item.title, " ", n, renders.current > 9 ? "+" : null);
};
Row.label = "Row";
const Stats: Component<{
  items: readonly Item[]
}
> = ({ items }) => {
  const done = useMemo(() => {
    log.push("count");
    return items.filter(i => i.done).length;
}, [items]);
  return [h("b", null, done, "/", items.length), done > 2 && h("i", { hidden: true }, "many")];
};
let nextId = 1;
const App: Component<{
  name: string
}
> = ({ name, children }) => {
  const [items, send] = useReducer((s: readonly Item[], a: Action): readonly Item[] => {
    switch (a.type) {
      case "add": return [...s, { id: nextId++, title: a.title, done: false }];
      case "toggle": return s.map(i => (i.id === a.id ? { ...i, done: !i.done } : i));
      case "remove": return s.filter(i => i.id !== a.id);
      case "sort": return [...s].sort((x,
        y) => (x.title < y.title ? -1 : x.title > y.title ? 1 : x.id - y.id));
    }
}, []);
  const [clicks, setClicks] = useState(0);
  useEffect(() => {
    log.push("items " + items.length);
}, [items.length]);
  return h("main", { title: name, style: { width: items.length },
    onAct: (e: DomEvent) => send(e.detail as Action), onClick: () => setClicks(c => c + 1) },
    h("h1", null, name, " ", clicks), h("ul", null, items.map(item => h(Row, { key: item.id,
    item, send }))), h(Stats, { items }), children);
};
const root = new Root().render(h(App, { name: "list" }, h("footer", null, "end")));
const main = () => [...root.dom.find(n => n.tag === "main")][0],
  rows = () => [...root.dom.find(n => n.tag === "li")];
let mixed = 0;
for (let i = 0; i < 700; i++) {
  switch (i % 7) {
    case 0: case 1: main().fire("act", { type: "add", title: "t" + ((i * 37) % 101) });
    break;
    case 2: rows()[i % rows().length].fire("click", "toggle");
    break;
    case 3: main().fire("act", { type: "sort" });
    break;
    case 4: if (rows().length > 12) rows()[i % rows().length].fire("click", "remove");
    break;
    case 5: root.render(h(App, { name: "list " + (i % 3) }, i % 2 ? h("footer", null, "end ",
      i) : "text"));
    break;
    default: rows()[0].fire("click");
  }
  root.flush();
  const html = root.dom.html;
  mixed = (mixed * 31 + html.length + html.charCodeAt(i % html.length)) >>> 0;
  if (i === 13 || i === 699) console.log(html);
}
console.log(mixed, root.patches, root.commits, DomNode.made, DomNode.moves, log.length,
  log.slice(0, 8).join("; "));
const Bad: Component<{
  n: number
}
> = ({ n }) => {
  if (n > 1) useState(0);
  return "bad " + n;
};
const other = new Root().render([h(Bad, { n: 1 }), h(FRAGMENT, null, "a", h("p", { key: 1 },
  1), "b")]);
console.log(other.dom.html);
try {
  other.render(h(Bad, { n: 2 }));
} catch (e) {
  console.log((e as Error).message);
}
try {
  useState(1);
} catch (e) {
  console.log((e as Error).message);
}
const Loop: Component<{
}
> = () => {
  const [n, set] = useState(0);
  useEffect(() => set(n + 1));
  return n;
};
try {
  new Root().render(h(Loop, null));
} catch (e) {
  console.log((e as Error).name, (e as Error).message);
}
