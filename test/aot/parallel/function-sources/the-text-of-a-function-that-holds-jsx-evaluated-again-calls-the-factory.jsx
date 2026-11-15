/** @jsxRuntime classic */
/** @jsx h */
/** @jsxFrag frag */
// JSX is no JavaScript: the text of a function holds the calls that the build wrote in its place, as it holds no types. Until then the text did not parse when it was evaluated again.
globalThis.h = (tag, props, ...kids) => ({ tag: typeof tag === "function" ? tag.name : tag, props, kids });
globalThis.frag = "frag";
globalThis.Part = function Part() {};
globalThis.shelf = { Part: function Inner() {} };
globalThis.more = { b: 2, c: 3 };
globalThis.list = [1, 2];
const forms = [
  () => <div />,
  () => <div></div>,
  () => <div id="a">b</div>,
  () => <div id="a &amp; b" data-kind='c "d"' hidden a:b="e" {...more} n={1 + 2} key="k" />,
  () => (
    <ul class="x">
      first &lt; second line
      <li>{list[0]}</li> <li>{list[1]}</li>
      {}
      {/* nothing */}
      {...list}
      {"text"}
    </ul>
  ),
  () => (
    <>
      <Part of={<i>in</i>} />
      <shelf.Part>
        <></>
      </shelf.Part>
    </>
  ),
  () => (
    <a on={() => <b>{more.b}</b>}>
      {list.map(n => (
        <i key={n}>{n}</i>
      ))}
    </a>
  ),
  () => <my-part />,
];
const again = text => (0, eval)("(" + text + ")");
for (const form of forms) console.log(JSON.stringify(again(form)()) === JSON.stringify(form()), JSON.stringify(form()));
// A function that stands in an attribute has its own text.
const inner = forms[6]().props.on;
console.log(JSON.stringify(again(inner)()));
