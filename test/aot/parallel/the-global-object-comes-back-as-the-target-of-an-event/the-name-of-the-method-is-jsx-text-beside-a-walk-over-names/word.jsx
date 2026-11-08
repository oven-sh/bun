/** @jsxRuntime classic */
/** @jsx take */
function take(tag, props, ...children) {
  return children[0];
}
export function send(signal, event) {
  const name = <i>dispatchEvent</i>;
  const taken = signal[name];
  taken(event);
}
