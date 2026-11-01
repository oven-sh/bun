function check(name, run) {
  let shown;
  try {
    shown = String(run());
  } catch (error) {
    shown = "throws " + error;
  }
  console.log(name + ": " + shown);
}
check("key before an attribute", () => { let v = 1, g; <a key={(v = 2, "k")} b={g = () => v} />; return g(); });
check("key before a child", () => { let v = 1, g; <a key={(v = 2, "k")}>{g = () => v}</a>; return g(); });
check("attribute before key", () => { let v = 1, g; <a b={g = () => v} key={(v = 2, "k")} />; return g(); });
check("closure in key, store in attribute", () => { let v = 1, g; <a key={(g = () => v, "k")} b={v = 2} />; return g(); });
check("closure in key, store in child", () => { let v = 1, g; <a key={(g = () => v, "k")}>{v = 2}</a>; return g(); });
check("two keys", () => { let v = 1, g; <a key={(v = 2, "k")} key={(g = () => v, "l")} />; return g(); });
check("two keys, other order", () => { let v = 1, g; <a key={(g = () => v, "k")} key={(v = 2, "l")} />; return g(); });
check("key behind a spread", () => { let v = 1, g; <a {...{}} key={(v = 2, "k")} b={g = () => v} />; return g(); });
check("key before a spread", () => { let v = 1, g; <a key={(v = 2, "k")} {...(g = () => v, {})} />; return g(); });
check("attribute before child", () => { let v = 1, g; <a b={g = () => v}>{v = 2}</a>; return g(); });
check("nested element", () => { let v = 1, g; <a key={(v = 2, "k")}><b c={g = () => v} /></a>; return g(); });
check("order", () => { const order = []; <a key={order.push("key")} b={order.push("b")}>{order.push("child")}</a>; return order; });
check("used: key before an attribute", () => { let v = 1, g; const e = <a key={(v = 2, "k")} b={g = () => v} />; return g() + e.key; });
check("used: key before a child", () => { let v = 1, g; const e = <a key={(v = 2, "k")}>{g = () => v}</a>; return g() + e.key; });
check("used: key before two children", () => { let v = 1, g; const e = <a key={(v = 2, "k")}>{g = () => v}{0}</a>; return g() + e.key; });
check("used: attribute before key", () => { let v = 1, g; const e = <a b={g = () => v} key={(v = 2, "k")} />; return g() + e.key; });
check("used: closure in key, store in attribute", () => { let v = 1, g; const e = <a key={(g = () => v, "k")} b={v = 2} />; return g() + e.key; });
check("used: closure in key, store in child", () => { let v = 1, g; const e = <a key={(g = () => v, "k")}>{v = 2}</a>; return g() + e.key; });
check("used: two keys", () => { let v = 1, g; const e = <a key={(v = 2, "k")} key={(g = () => v, "l")} />; return g() + e.key; });
check("used: two keys, other order", () => { let v = 1, g; const e = <a key={(g = () => v, "k")} key={(v = 2, "l")} />; return g() + e.key; });
check("used: key behind a spread", () => { let v = 1, g; const e = <a {...{}} key={(v = 2, "k")} b={g = () => v} />; return g() + e.props.key; });
check("used: nested element", () => { let v = 1, g; const e = <a key={(v = 2, "k")}><b c={g = () => v} /></a>; return g() + e.key; });
check("used: component", () => { let v = 1, g; const C = () => 0; const e = <C key={(v = 2, "k")} b={g = () => v} />; return g() + e.key; });
check("used: order", () => { const order = []; const e = <a key={order.push("key")} b={order.push("b")}>{order.push("child")}</a>; return order; });
check("order with two keys", () => { const order = []; <a key={order.push("first key")} b={order.push("b")} key={order.push("last key")}>{order.push("child")}</a>; return order; });
check("used: order with two keys", () => { const order = []; const e = <a key={order.push("first key")} b={order.push("b")} key={order.push("last key")}>{order.push("child")}</a>; return order; });
check("order of a component", () => { const order = []; const C = () => 0; <C key={order.push("key")} b={order.push("b")}>{order.push("child")}</C>; return order; });
