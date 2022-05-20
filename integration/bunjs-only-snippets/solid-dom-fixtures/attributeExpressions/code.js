const selected = true;
let id = "my-h1";
let link;
const template = (
  <div
    id="main"
    {...results}
    classList={{ selected: unknown }}
    style={{ color }}
  >
    <h1
      class="base"
      id={id}
      {...results()}
      disabled
      readonly=""
      title={welcoming()}
      style={{ "background-color": color(), "margin-right": "40px" }}
      classList={{ dynamic: dynamic(), selected }}
    >
      <a href={"/"} ref={link} classList={{ "ccc ddd": true }} readonly={value}>
        Welcome
      </a>
    </h1>
  </div>
);

const template2 = (
  <div {...getProps("test")}>
    <div textContent={rowId} />
    <div textContent={row.label} />
    <div innerHTML={"<div/>"} />
  </div>
);

const template3 = (
  <div
    id={/*@once*/ state.id}
    style={/*@once*/ { "background-color": state.color }}
    name={state.name}
    textContent={/*@once*/ state.content}
  />
);

const template4 = (
  <div class="hi" className={state.class} classList={{ "ccc:ddd": true }} />
);

const template5 = <div class="a" className="b"></div>;

const template6 = <div style={someStyle()} textContent="Hi" />;

const template7 = (
  <div
    style={{
      "background-color": color(),
      "margin-right": "40px",
      ...props.style,
    }}
    style:padding-top={props.top}
    class:my-class={props.active}
  />
);

let refTarget;
const template8 = <div ref={refTarget} />;

const template9 = <div ref={(e) => console.log(e)} />;

const template10 = <div ref={refFactory()} />;

const template11 = <div use:something use:another={thing} use:zero={0} />;

const template12 = <div prop:htmlFor={thing} />;

const template13 = <input type="checkbox" checked={true} />;

const template14 = <input type="checkbox" checked={state.visible} />;

const template15 = <div class="`a">`$`</div>;

const template16 = (
  <button
    class="static"
    classList={{
      hi: "k",
    }}
    type="button"
  >
    Write
  </button>
);

const template17 = (
  <button
    classList={{
      a: true,
      b: true,
      c: true,
    }}
    onClick={increment}
  >
    Hi
  </button>
);

const template18 = (
  <div
    {...{
      get [key()]() {
        return props.value;
      },
    }}
  />
);
