import { Wrapper, idOf, make } from "./model.ts";
export function run() {
  const lines = [];
  const wrapper = make(1);
  lines.push(idOf(wrapper));
  wrapper.put({ id: 2, extra: "two" });
  lines.push(idOf(wrapper), wrapper.value.extra);
  wrapper.put(new Wrapper({ id: 3 }));
  lines.push(idOf(wrapper));
  wrapper.putTwice({ id: 4 }, make(5));
  lines.push(idOf(wrapper));
  lines.push(wrapper.take(make(6)).id, idOf(wrapper));
  const inner = wrapper.wrap({ id: 7, more: [1, 2] });
  lines.push(inner.value.id, inner.value.more.length, inner instanceof Wrapper);
  lines.push(idOf(wrapper.pick(make(8), make(9), false)));
  const tagged = Object.assign(make(10), { tag: { id: 11 } });
  lines.push(idOf(wrapper.pick(tagged, make(12), true)), tagged.tag.id);
  lines.push(wrapper.same(wrapper), wrapper.same(wrapper.value), wrapper.same({ id: 6 }));
  return lines;
}
