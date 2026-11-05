// Prints the frames of what is thrown below a JSX element, with a factory that calls the component at once. An element is a call of the factory: where it is the last thing a function of strict code does, the call takes the frame of the function out of the stack trace.
/** @jsxImportSource ./eager */
const frames = error => String(error && error.stack).split("\n").slice(1, 6).map(line => line.trim().replace(/^at /, "").replace(/\(?[^ (]*[\\/]/, "(").replace(/^\(([^ ]*:\d+:\d+)$/, "($1)")).join(" < ");
function attempt(run) { try { const result = run(); console.log(run.name + ": nothing " + typeof result); } catch (error) { console.log(run.name + ": " + (error && error.constructor.name) + " " + frames(error)); } }
const hide = value => [value, 0][Number(process.argv.length > 100)];
const nothing = hide(undefined), five = hide(5), holder = hide({ inner: null });
function fail() { throw new Error("thrown"); }
function Throws() { return fail(); }
function ReadsProps(props) { return props.a.b; }
function Wraps(props) { return <div>{props.children}</div>; }
function Nested() { return <Wraps><Throws /></Wraps>; }
attempt(function child() { return <div>{nothing.x}</div>; });
attempt(function secondChild() { return <div>text {five} {nothing.x}</div>; });
attempt(function prop() { return <div a={nothing.x} />; });
attempt(function secondProp() { return <div a="1" b={nothing.x} />; });
attempt(function propCall() { return <div a={fail()} />; });
attempt(function childCall() { return <div>{fail()}</div>; });
attempt(function spreadProps() { return <div {...nothing.x} />; });
attempt(function missingComponent() { return <Missing />; });
attempt(function memberComponent() { return <holder.inner.X />; });
attempt(function component() { return <Throws />; });
attempt(function componentWithProps() { return <ReadsProps c="1" />; });
attempt(function componentInChild() { return <div><Throws /></div>; });
attempt(function nested() { return <Nested />; });
attempt(function fragment() { return <>{nothing.x}</>; });
attempt(function fragmentComponent() { return <><Throws /></>; });
attempt(function keyProp() { return <div key={nothing.x} />; });
attempt(function conditional() { return five ? <Throws /> : null; });
attempt(function logical() { return five && <Throws />; });
attempt(function mapped() { return <ul>{[1].map(item => <li key={item}>{nothing.x}</li>)}</ul>; });
attempt(function mappedComponent() { return <ul>{[1].map(item => <Throws key={item} />)}</ul>; });
attempt(function kept() { const element = <Throws />; return element; });
attempt(function keptInChild() { const element = <Throws />; return <div>{element}</div>; });
attempt(function keptValue() { const value = nothing.x; return <div>{value}</div>; });
attempt(function keptProp() { const value = nothing.x; return <div a={value} />; });
attempt(function multiline() {
  return (
    <div
      a="1"
      b={nothing.x}
    >
      <Throws />
    </div>
  );
});
attempt(function multilineChild() {
  return (
    <div>
      text
      <Throws />
    </div>
  );
});
attempt(function templateProp() { return <div a={`${Symbol()}`} />; });
attempt(function sumProp() { return <div a={1n + five} />; });
attempt(function arrowProp() { return <div a={() => fail()} />.props.a(); });
