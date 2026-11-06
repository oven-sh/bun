function tell(label, run) {
  try { run(); console.log(label + ": no error"); } catch (error) { console.log(label + ": " + JSON.stringify(error.message)); }
}
const o = { none: null, deep: {}, same(value) { return value; } };

tell("function", () => o.nothing(function(){ return 1 }));
tell("named function", () => o.nothing(function  named( a,b ){ return a+b }));
tell("arrow with a block", () => o.nothing(x => { return x }, 1));
tell("arrow", () => o.nothing(x=>x, 1));
tell("arrow of two", () => o.nothing(( a,b )=>a+b));
tell("async function", () => o.nothing(async function(){ await 1 }));
tell("async arrow", () => o.nothing(async x=>{ await x }));
tell("generator", () => o.nothing(function*(){ yield 1 }));
tell("class", () => o.nothing(class{ m(){ return 1 } }));
tell("class with members", () => o.nothing(class  K  extends  Object{ static s = 1; #p = 2; get a(){ return this.#p } static { K.t = 3 } }));
tell("method", () => o.nothing({ m(){ return 1 } }));
tell("method without blanks", () => o.nothing({m(){return 1}}));
tell("accessors", () => o.nothing({ get a(){ return 1 }, set a( v ){ } }));
tell("function as a property", () => o.nothing({ f: function(){ return 1 }, g: ()=>{ return 2 } }));
tell("function in a list", () => o.nothing([function(){ return 1 }, 2]));
tell("statements", () => o.deep.nothing(function( a,b ){ if(a) return b; for(const c of b) { a += c } while(a) a--; return 2 }));
tell("rewritten statements", () => o.nothing(function(){
    const a = 1;

    // a comment
    if (a) {
        return a
    } else { return 2 }
}, 2, () => { return 3 }));
tell("comments", () => o.nothing(function(){ /* c */ return 1 /* d */ }, /* e */ 2));
tell("a bracket in a text", () => o.nothing(function(){ return ")" }));
tell("a bracket in a template", () => o.nothing(function(){ return `a${1})` }));
tell("a bracket in a regular expression", () => o.nothing(function(){ return /\)/ }));
tell("a curly bracket in a text", () => o.nothing(function(){ return "}" }, 1));
tell("default of a parameter", () => o.nothing(function( a = function(){ return 1 } ){ return a }));

tell("call in a call", () => o.nothing(o.deep.other(function(){ return 1 })));
tell("call in a call, the outer one", () => o.nothing(o.same(function(){ return 1 })));
tell("two functions", () => o.nothing(function(){ return 1 }, function(){ return 2 }));
tell("function in a function", () => o.nothing(function(){ return function(){ return 1 } }));
tell("a call in the function fails", () => o.same(function(){ o.nothing(function(){ return 1 }) })());
tell("a read in the function fails", () => o.same(function(){ return o.none.a })());
tell("chain", () => o.same(function(){ return 1 }).nothing(function(){ return 2 }));
tell("chain over lines", () => o
    .same(function(){ return 1 })
    .nothing(function(){ return 2 }));
tell("in front of a call", () => o.nothing(1).then(function(){ return 1 }));
tell("optional", () => o.deep?.nothing(function(){ return 1 }));
tell("of the parent", () => { class A { m() { return super.nothing(function(){ return 1 }); } } new A().m(); });

tell("constructed", () => new o.nothing(function(){ return 1 }));
tell("constructed with a class", () => new o.nothing(class{ }));
tell("read behind a call", () => o.deep.toString(function(){ return 1 }).a.b);
tell("read behind a function", () => (function(){ return 1 }).a.b);
tell("read behind an arrow", () => (()=>{ return 1 }).a.b);
tell("read behind a call of an arrow", () => (() => null)().a);
tell("read behind a call of a function over lines", () => (function(){
    return null
})().a);
tell("method of an arrow", () => (() => 1).apply(null, 5));
tell("read of null in front of a function", () => o.none.f(function(){ return 1 }));
tell("element", () => o.same(function(){ return 1 })[ "a" ][ o.deep ]);
tell("in", () => "a" in o.deep.toString(function(){ return 1 }));
tell("instanceof", () => o instanceof o.deep.toString(function(){ return 1 }));

tell("blanks", () => o.nothing( 1,2 ));
tell("object", () => o.nothing({a:1,"b":2,[o]:3}));
tell("list", () => o.nothing([1,2,,3]));
tell("operators", () => o.nothing(1+o.deep,-o.deep,!o,typeof  o,o?1:2,o  .deep));
tell("spread", () => o.nothing(...  [1], ...o.deep));
tell("template", () => o.nothing(`a${ o }b`));
tell("last comma", () => o.nothing(1, 2, ));
tell("arguments over lines", () => o.nothing(
    1,
    2,
));
tell("object over lines", () => o.nothing({
        a: 1,
        b: [
            1,
        ],
}));
tell("object over lines with a method", () => o.nothing({
        a: 1,
        m() { return 1 },
        f: function(){ return 2 },
}));
tell("list over lines with a function", () => o.nothing([
        function(){ return 1 },
        x=>x,
]));
tell("blanks in an element", () => o.none[ 1+2 ]);

tell("deeper", function(){ if (o) { o.nothing(function(){ return 1 }) } });
tell("deeper still", function(){ for (;;) { switch (1) { case 1: { o.nothing({
  m(){ return 1 } }) } } } });
class Holder { method() { o.nothing(function(){ return 1 }, { a(){ return 2 } }); } static run() { new Holder().method(); } }
tell("in a method", Holder.run);

try { o.nothing(function(){ return 1 }); } catch (error) { console.log("at the top: " + JSON.stringify(error.message)); }
try { o.nothing(class { static x = 1 }); } catch (error) { console.log("at the top, a class: " + JSON.stringify(error.message)); }
try { o.nothing(x=>x, async( a )=>{ await a }); } catch (error) { console.log("at the top, arrows: " + JSON.stringify(error.message)); }
try { new o.nothing(function(){ return 1 }); } catch (error) { console.log("at the top, constructed: " + JSON.stringify(error.message)); }
try { o.same(function(){ return 1 }).a.b; } catch (error) { console.log("at the top, a read: " + JSON.stringify(error.message)); }
if (o) { try { o.nothing(a => { return a }); } catch (error) { console.log("at the top, deeper: " + JSON.stringify(error.message)); } }
