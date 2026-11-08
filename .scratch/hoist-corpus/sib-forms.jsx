import { useState, useEffect } from "react";
// S1: the report. helper is not hoisted by the scan; sibling is called above both.
export function S1_Report(p) {
  const v = sibling();
  function helper() {
    return p.a;
  }
  function sibling() {
    return helper();
  }
  return <button onClick={helper}>{v}</button>;
}
// S2: helper is hoisted by a dead early reference and a memo block declares it; sibling is called above both.
export function S2_DeadRefAndSibling(p) {
  const unused = () => helper();
  const v = sibling();
  function helper() {
    return p.a;
  }
  function sibling() {
    return helper();
  }
  return <button onClick={helper}>{v}</button>;
}
// S2b: same, sibling declared above helper.
export function S2b_SiblingFirst(p) {
  const unused = () => helper();
  const v = sibling();
  function sibling() {
    return helper();
  }
  function helper() {
    return p.a;
  }
  return <button onClick={helper}>{v}</button>;
}
// S3: both escape.
export function S3_BothEscape(p) {
  const unused = () => helper();
  const v = sibling();
  function helper() {
    return p.a;
  }
  function sibling() {
    return helper();
  }
  return <button onClick={helper} onFocus={sibling}>{v}</button>;
}
// S5: the early call is in an event handler (runs later).
export function S5_Handler(p) {
  const onClick = () => sibling();
  function helper() {
    return p.a;
  }
  function sibling() {
    return helper();
  }
  return <button onClick={onClick}>{p.a}</button>;
}
// S6: useState(getItem) with getItem calling a function declared above it.
export function S6_UseState(p) {
  const [v] = useState(getItem);
  function read() {
    return p.a;
  }
  function getItem() {
    return read();
  }
  return <button onClick={read}>{v}</button>;
}
// Control: textual order that needs no hoisting.
export function C_Ordered(p) {
  function helper() {
    return p.a;
  }
  function sibling() {
    return helper();
  }
  const v = sibling();
  return <button onClick={helper}>{v}</button>;
}
