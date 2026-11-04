// `const [f = function( x ){ return x }] = null`: the message quotes the list as Bun prints it, and Bun prints the statements of a body anew, each on a line of its own.
function tell(label, run) {
  try {
    run();
    console.log(label + ": no error");
  } catch (error) {
    console.log(label + ": " + error.constructor.name + ": " + JSON.stringify(error.message));
  }
}
const lists = {
  oneStatement(v) { const [ f = function( x ){ return x } ] = v; return f; },
  named(v) { const [ f = function  g( x,y ){ return x+y } ] = v; return f; },
  severalStatements(v) { const [ f = function(x){ let y = x*2; y++; return y } ] = v; return f; },
  emptyFunction(v) { const [ f = function( ){ } ] = v; return f; },
  onlyAComment(v) { const [ f = function(){ /* nothing */ } ] = v; return f; },
  arrow(v) { const [ f = x=>{ return x } ] = v; return f; },
  arrowOfTwo(v) { const [ f = ( x,y )=>{ const z = x; return z+y } ] = v; return f; },
  emptyArrow(v) { const [ f = ()=>{ } ] = v; return f; },
  arrowOfAnObject(v) { const [ f = ()=>({a:1}) ] = v; return f; },
  asyncFunction(v) { const [ f = async function( x ){ await x; return x } ] = v; return f; },
  asyncArrow(v) { const [ f = async x=>{ await x } ] = v; return f; },
  generator(v) { const [ f = function*( x ){ yield x; yield* x } ] = v; return f; },
  asyncGenerator(v) { const [ f = async function*( x ){ yield await x } ] = v; return f; },
  emptyClass(v) { const [ K = class{ } ] = v; return K; },
  namedClass(v) { const [ K = class  L  extends  Object{ } ] = v; return K; },
  method(v) { const [ K = class{ m( x ){ return x } } ] = v; return K; },
  members(v) { const [ K = class{ a=1; static b = 2; #c = 3; get d(){ return this.#c } set d( x ){ this.#c = x } static e( ){ } static { K.f = 1 } constructor( ){ this.g = 1 } } ] = v; return K; },
  derived(v) { const [ K = class extends Array{ constructor( ){ super( ); this.a = 1 } } ] = v; return K; },
  parentWithABody(v) { const [ K = class extends (class{ m(){ return 1 } }){ n(){ return 2 } } ] = v; return K; },
  methodOfAnObject(v) { const [ o = { m( x ){ return x } } ] = v; return o; },
  accessorsOfAnObject(v) { const [ o = { get a(){ return 1 }, set a( x ){ }, async b(){ await 1 }, *c(){ yield 1 }, async *e(){ yield 2 }, ['d'+1](){ return 2 }, 'f g'(){ return 3 }, 1(){ return 4 } } ] = v; return o; },
  functionInAnObject(v) { const [ o = { f:function(){ return 1 }, g:()=>{ return 2 } } ] = v; return o; },
  functionInAList(v) { const [ l = [ function(){ return 1 },()=>{ return 2 } ] ] = v; return l; },
  functionInACall(v) { const [ r = [ 1 ].map( function( x ){ return x*2 } ) ] = v; return r; },
  calledAtOnce(v) { const [ r = (function(){ return 1 })( ), s = (()=>{ return 2 })( ) ] = v; return r + s; },
  inBrackets(v) { const [ f = (function(){ return 1 }) ] = v; return f; },
  functionInAFunction(v) { const [ f = function(){ return function(){ return ()=>{ return 1 } } } ] = v; return f; },
  functionInAParameter(v) { const [ f = function( g = function(){ return 1 } ){ return g } ] = v; return f; },
  two(v) { const [ f = function(){ return 1 }, g = function(){ return 2 } ] = v; return f + g; },
  betweenOthers(v) { const [ a,f = function(){ return 1 },b = 2 ] = v; return a + f + b; },
  inAnInnerList(v) { const [ [ f = function(){ return 1 } ] ] = v; return f; },
  inAnInnerObject(v) { const [ { f = function(){ return 1 } } ] = v; return f; },
  assigned(v) { let f; [ f = function(){ return 1 } ] = v; return f; },
  inALoop(v) { for (const [ f = function(){ return 1 } ] of v) return f; },
  inALoopAssigned(v) { let f; for ([ f = function(){ return 1 } ] of v) return f; },
  parameter([ f = function(){ return 1 } ]) { return f; },
  caught(v) { try { throw v; } catch ([ f = function(){ return 1 } ]) { return f; } },

  conditions(v) { const [ f = function( x ){ if (x) return 1; else return 2 } ] = v; return f; },
  conditionWithBlocks(v) { const [ f = function( x ){ if (x) { x++ } else if (!x) { x-- } else { x = 0 } return x } ] = v; return f; },
  loops(v) { const [ f = function( x ){ for (let i=0;i<x;i++) x--; while (x) x--; do { x++ } while (x<1); for (const k in x) k; for (const e of x) e; return x } ] = v; return f; },
  choice(v) { const [ f = function( x ){ switch (x) { case 1: return 'a'; case 2: { return 'b' } default: return 'c' } } ] = v; return f; },
  attempts(v) { const [ f = function( x ){ try { x() } catch (e) { throw e } finally { x = 0 } } ] = v; return f; },
  labels(v) { const [ f = function( x ){ outer: for (;;) { for (;;) { break outer } } return x } ] = v; return f; },
  declarations(v) { const [ f = function(){ var a = 1,b; let c = 2; const d = 3; function g(){ return a } class K{ } return [ a,b,c,d,g,K ] } ] = v; return f; },
  directive(v) { const [ f = function(){ 'use strict'; return this } ] = v; return f; },

  sumsAreFolded(v) { const [ f = function(){ return 1+2 } ] = v; return f; },
  shortLiterals(v) { const [ f = function(){ return [ true,false,undefined,null ] } ] = v; return f; },
  quotes(v) { const [ f = function(){ return 'a'+"b"+`c`+'it\'s'+"\"" } ] = v; return f; },
  templates(v) { const [ f = function( x ){ return `a${ x }b${ `c${ x }` }` } ] = v; return f; },
  regularExpressions(v) { const [ f = function( x ){ return /[}\]]/.test( x ) } ] = v; return f; },
  bracesInTexts(v) { const [ f = function(){ return '}'+"{"+`}` } ] = v; return f; },
  bracesInComments(v) { const [ f = function(){ /* } */ return 1 // }
  } ] = v; return f; },
  numbers(v) { const [ f = function(){ return [ 0x10,1_000,10000,.5,1.0,1e3 ] } ] = v; return f; },
  keys(v) { const [ f = function( o ){ return o['a']+o["b c"]+o[0] } ] = v; return f; },
  idleBrackets(v) { const [ f = function( a,b ){ return ((a)+(b))*(a) } ] = v; return f; },
  deadCode(v) { const [ f = function(){ if (false) { return 1 } return 2 } ] = v; return f; },
  behindTheReturn(v) { const [ f = function(){ return 1; return 2 } ] = v; return f; },
  constantsInPlace(v) { const [ f = function(){ const a = 1; return a+1 } ] = v; return f; },
  conditionBecomesAValue(v) { const [ f = function( x ){ if (x) return 1; return 2 } ] = v; return f; },
  letters(v) { const [ f = function(){ return 'é'+'é'+'日本'+'\n\t' } ] = v; return f; },
  namesFromOutside(v) { const [ f = function(){ return tell+lists+v } ] = v; return f; },
};
function overLines(v) {
  const [
    f = function (x) {
          return x
    },
    g = (x) => {
  return x;
    },
    K = class {
        m() { return 1 }
    },
    o = {
      m() { return 1 },
    },
  ] = v;
  return f + g + K + o;
}
function bodyOverLinesInAListOnOneLine(v) {
  const [f = function (x) {
        const y = x;
    return y;
  }] = v;
  return f;
}
class Holder {
  method(v) {
    if (v !== 1) {
      const [ f = function(){ return 1 }, K = class{ m(){ return 2 } } ] = v;
      return f + K;
    }
  }
}
function deep(v) {
  return {
    a: {
      b(w) {
        const [
          f = function () { return { c: 1,
            d: [
              2 ] } },
        ] = w;
        return f;
      },
    },
  }.a.b(v);
}
// A list in a body that lies in a list is quoted by itself.
function listInABody(v, w) {
  const [ f = function( u ){ const [ x,y ] = u; return x+y } ] = v;
  return f(w);
}
function listOverLinesInABody(v, w) {
  const [ f = function( u ){ const [
      x,
        y,
  ] = u; return x+y } ] = v;
  return f(w);
}
function bodyInAListInABody(v, w) {
  const [ f = function( u ){ const [ g = function(){ return 1 } ] = u; return g } ] = v;
  return f(w);
}
function listInAMethodInAClass(v, w) {
  const [ K = class{ m( u ){ const [
    x = ()=>{ return 1 },
  ] = u; return x } } ] = v;
  return new K().m(w);
}
// What fails in such a body is quoted as ever.
function readInABody(v, w) {
  const [ f = function( u ){ return u.a.b } ] = v;
  return f(w);
}
function callInABody(v, w) {
  const [ f = function( u ){ return u.a(1, 2) } ] = v;
  return f(w);
}
Object.assign(lists, { overLines, bodyOverLinesInAListOnOneLine, inAMethod: v => new Holder().method(v), deep });
Object.assign(globalThis, lists);
for (const bad of [null, undefined]) {
  for (const name of Object.keys(lists)) tell(name + " " + bad, () => globalThis[name](bad));
  tell("inAnInnerList, inside " + bad, () => lists.inAnInnerList([bad]));
  tell("inALoop, inside " + bad, () => lists.inALoop([bad]));
  tell("inALoopAssigned, inside " + bad, () => lists.inALoopAssigned([bad]));
  for (const inner of [listInABody, listOverLinesInABody, bodyInAListInABody, listInAMethodInAClass, readInABody, callInABody]) {
    tell(inner.name + " " + bad, () => inner(bad, bad));
    tell(inner.name + ", inside " + bad, () => inner([], bad));
  }
}
tell("readInABody, deeper", () => readInABody([], {}));
tell("callInABody, deeper", () => callInABody([], {}));
// At the top level of a file.
let assigned;
try { const [ f = function(){ return 1 }, K = class{ } ] = globalThis.nothing; } catch (error) { console.log("at the top: " + JSON.stringify(error.message)); }
try { const [ f = x=>x ] = globalThis.nothing; } catch (error) { console.log("at the top, an arrow: " + JSON.stringify(error.message)); }
try { const [ K = class{ m(){ return 1 } static n(){ return 2 } } ] = globalThis.nothing; } catch (error) { console.log("at the top, methods: " + JSON.stringify(error.message)); }
try { const [ o = { m(){ return 1 } } ] = globalThis.nothing; } catch (error) { console.log("at the top, an object: " + JSON.stringify(error.message)); }
try { [ assigned = ()=>{ return 1 } ] = globalThis.nothing; } catch (error) { console.log("at the top, assigned: " + JSON.stringify(error.message)); }
try { for (const [ f = ()=>{ return 1 } ] of globalThis.nothing); } catch (error) { console.log("at the top, a loop: " + JSON.stringify(error.message)); }
try { for (const [ f = ()=>{ return 1 } ] of [globalThis.nothing]); } catch (error) { console.log("at the top, in a loop: " + JSON.stringify(error.message)); }
try {
  const [
    f = function () { const [ x = ()=>{ return 1 } ] = globalThis.nothing; return x },
  ] = [];
  f();
} catch (error) {
  console.log("at the top, a list in a body: " + JSON.stringify(error.message));
}
