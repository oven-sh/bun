// RUN: lower

// FILE: main.ts
declare const console: { log(...values: unknown[]): void };
interface B { n: number; add(k: number): B }
function make(): B { return { n: 0, add(k) { this.n += k; return this; } }; }
function f() { let b = make(); b = b.add(0).add(1).add(2).add(3).add(4).add(5).add(6).add(7).add(8).add(9).add(10).add(11).add(12).add(13).add(14).add(15).add(16).add(17).add(18).add(19).add(20).add(21).add(22).add(23).add(24).add(25).add(26).add(27).add(28).add(29).add(30).add(31).add(32).add(33).add(34).add(35).add(36).add(37).add(38).add(39).add(40).add(41).add(42).add(43).add(44).add(45).add(46).add(47).add(48).add(49).add(50).add(51).add(52).add(53).add(54).add(55).add(56).add(57).add(58).add(59); return b.n; }
console.log(f());
