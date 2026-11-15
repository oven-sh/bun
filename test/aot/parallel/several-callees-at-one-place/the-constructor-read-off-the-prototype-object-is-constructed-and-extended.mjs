const k = class { m() { return 4; } }; const C = Object.getPrototypeOf(new k()).constructor; console.log(new C().m(), new (class extends C {})().m());
