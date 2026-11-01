// `const [ x,y ] = null`: the message quotes the list as Bun prints it, '[x, y]', however its blanks, commas and comments are written.
const lists = {
  blanksInside(v) { const [ x ] = v; return x; },
  blankAtTheStart(v) { const [ x] = v; return x; },
  blankAtTheEnd(v) { const [x ] = v; return x; },
  noBlankBehindTheComma(v) { const [x,y] = v; return x + y; },
  blankInFrontOfTheComma(v) { const [x , y] = v; return x + y; },
  manyBlanks(v) { const [   x   ,    y   ] = v; return x + y; },
  tabs(v) { const [	x,	y	] = v; return x + y; },
  listInList(v) { const [ [ x ] ] = v; return x; },
  twoListsInList(v) { const [ [ x ],[ y ] ] = v; return x + y; },
  hole(v) { const [ , x ] = v; return x; },
  holes(v) { const [,,x] = v; return x; },
  holeAtTheEnd(v) { const [x,,] = v; return x; },
  onlyAHole(v) { const [ , ] = v; return 1; },
  commaAtTheEnd(v) { const [ x, y, ] = v; return x + y; },
  nothing(v) { const [ ] = v; return 1; },
  rest(v) { const [ x, ... r ] = v; return r; },
  listInTheRest(v) { const [ ...[ x ] ] = v; return x; },
  object(v) { const [{x}] = v; return x; },
  wideObject(v) { const [ {  x  } ] = v; return x; },
  renamed(v) { const [{x:y}, { z  :  w }] = v; return y + w; },
  objectOfAll(v) { const [{x,y=1,...r}] = v; return r; },
  keys(v) { const [{[ 'a' + 'b' ]:y, 'c d':z, 1:w}] = v; return y + z + w; },
  emptyObject(v) { const [ { } ] = v; return 1; },
  comments(v) { const [ /* it's */ a /* ] */, b /* , */ = /* one */ 1 /* last */ ] = v; return a + b; },
  defaults(v) { const [x=1, y   =   2, z = 'a  b'] = v; return x + y + z; },
  lettersThatAreWordsElsewhere(v) { const [ of,get,set,async ] = v; return of; },
  operators(v) { let [ a=1+2*3, b = - 1, c = !v, d = typeof  v, e = v&&v.a||v.b, f = v??1, g = a<b, h = a===b, i = a ? -b : +c, j = a - -b, k = ~a, l = a++, m = --a, n = a**2, o = v  in  v, p = v instanceof Object, q = v?1:2 ] = v; return a; },
  values(v) { const [ a = [ 1,2 ], b = {c:1}, c = { }, d = [ ], e = v ? { f:1 } : [ 2 ], g = [ ...v ], h = { ...v }, i = new  Map( ), j = new Map( ).size, k = new Set( [ 1 ] ) ] = v; return a; },
  members(v) { const [ a = v . b, b = v ?. b, c = v[ 0 ], d = v ?. [ 0 ], e = v . f ( ), f = v ?. ( 1 ), g = Math.max( 1,2 ) ] = v; return a; },
  functions(v) { const [ a = x=>x, b = async x=>x, c = ( x,y )=>x, d = ()=>1, e = function( x ){ }, f = function  g( ){} ] = v; return a; },
  texts(v) { const [ a = "a,b", b = `x  ${ v }  y`, c = /[,\]]  /g, d = 'a]', e = "[" ] = v; return a; },
  parameter([ x ]) { return x; },
  listInParameter([ [ x ] ]) { return x; },
  assigned(v) { let x; [ x ] = v; return x; },
  assignedInList(v) { let x; [ [ x ] ] = v; return x; },
  assignedToMembers(v) { const o = {}; [ o.a,o[ 'b' ] ] = v; return o; },
  caught(v) { try { throw v; } catch ([ x ]) { return x; } },
  underAName(v) { const { p: [ x ] } = { p: v }; return x; },
  loop(v) { for (const [ x,y ] of v) return x + y; },
  loopThatAssigns(v) { let x, y; for ([ x,y ] of v) return x + y; },
  loopOverObjects(v) { for (const {a,b} of v) return a + b; },
  loopWithAName(v) { for (const  x  of  v) return x; },
  loopOverAMember(v) { const o = {}; for (o . x of v) return o; },
};
const arrow = ([ x ]) => x;
// An executable keeps the text of a function that something may ask for it.
globalThis.kept = { ...lists, arrow };

for (const nothing of [null, undefined]) {
  for (const [name, take] of Object.entries(globalThis.kept)) {
    for (const [depth, value] of [["outer", nothing], ["inner", [nothing]]]) {
      try {
        take(value);
      } catch (error) {
        console.log(name, depth, nothing + ":", error.name, JSON.stringify(error.message));
      }
    }
  }
}
