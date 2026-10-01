namespace N1 { export enum E { A, B } }
namespace N2 { export enum E { A, B } }
namespace N3 { export enum E { A, C } }
namespace N4 { export enum E { A = 1, B = 2 } }
let e1: N1.E = N2.E.A;
let e2: N1.E = N3.E.A;
declare let e3: N3.E;
let e4: N1.E = e3;
declare let e5: N4.E;
let e6: N1.E = e5;
let e7: N1.E = 1;
let e8: N1.E.A = 1;
let e9: number = N1.E.A;
