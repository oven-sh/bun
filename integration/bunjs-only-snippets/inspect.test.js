import { it, expect } from "bun:test";

it("jsx with two elements", () => {
  const input = Bun.inspect(
    <div hello="quoted">
      <input type="text" value={"123"} />
      string inside child
    </div>
  );

  const output = `<div hello="quoted">
  <input type="text" value="123" />
  string inside child
</div>`;

  expect(input).toBe(output);
});

const Foo = () => <div hello="quoted">foo</div>;

it("jsx with anon component", () => {
  const input = Bun.inspect(<Foo />);

  const output = `<NoName />`;

  expect(input).toBe(output);
});

it("jsx with fragment", () => {
  const input = Bun.inspect(<>foo bar</>);

  const output = `<>foo bar</>`;

  expect(input).toBe(output);
});

it("inspect", () => {
  expect(Bun.inspect(new TypeError("what")).includes("TypeError: what")).toBe(
    true
  );

  expect("hi").toBe("hi");
  expect(Bun.inspect(1)).toBe("1");
  expect(Bun.inspect(1, "hi")).toBe("1 hi");
  expect(Bun.inspect([])).toBe("[]");
  expect(Bun.inspect({})).toBe("{ }");
  expect(Bun.inspect({ hello: 1 })).toBe("{ hello: 1 }");
  expect(Bun.inspect({ hello: 1, there: 2 })).toBe("{ hello: 1, there: 2 }");
  expect(Bun.inspect({ hello: "1", there: 2 })).toBe(
    '{ hello: "1", there: 2 }'
  );
  expect(Bun.inspect({ 'hello-"there': "1", there: 2 })).toBe(
    '{ "hello-\\"there": "1", there: 2 }'
  );
  var str = "123";
  while (str.length < 4096) {
    str += "123";
  }
  expect(Bun.inspect(str)).toBe(str);
  // expect(Bun.inspect(new Headers())).toBe("Headers (0 KB) {}");
  expect(Bun.inspect(new Response()).length > 0).toBe(true);

  // expect(
  //   JSON.stringify(
  //     new Headers({
  //       hi: "ok",
  //     })
  //   )
  // ).toBe('{"hi":"ok"}');
  expect(Bun.inspect(new Set())).toBe("Set {}");
  expect(Bun.inspect(new Map())).toBe("Map {}");
  expect(Bun.inspect(new Map([["foo", "bar"]]))).toBe(
    'Map(1) {\n  "foo": "bar",\n}'
  );
  expect(Bun.inspect(new Set(["bar"]))).toBe('Set(1) {\n  "bar",\n}');
  expect(Bun.inspect(<div>foo</div>)).toBe("<div>foo</div>");
  expect(Bun.inspect(<div hello>foo</div>)).toBe("<div hello=true>foo</div>");
  expect(Bun.inspect(<div hello={1}>foo</div>)).toBe("<div hello=1>foo</div>");
  expect(Bun.inspect(<div hello={123}>hi</div>)).toBe(
    "<div hello=123>hi</div>"
  );
  expect(Bun.inspect(<div hello="quoted">quoted</div>)).toBe(
    '<div hello="quoted">quoted</div>'
  );
  expect(
    Bun.inspect(
      <div hello="quoted">
        <input type="text" value={"123"} />
      </div>
    )
  ).toBe(`<div hello="quoted">
  <input type="text" value="123" />
</div>`);
  expect(Bun.inspect(BigInt(32)), "32n");
});
