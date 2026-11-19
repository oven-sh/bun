const object = { m (a){}, async  n ( a , b ){}, *g(a){}, async*h ( a ){}, get  x (){}, set x ( v ){}, "s t" (a){}, 12 (a){}, o(a /* first */, b){}, p(
  a,
  b,
){} };
class Kept { static  s ( a ){} static async *t(){} #p(a){} static #q ( a ){} get  y (){} m ( a , b ){} both(){ return [this.#p, Kept.#q]; } }
const accessor = (holder, name) => Object.getOwnPropertyDescriptor(holder, name);
const forms = [
  function(){}, function (){}, function  ( ){}, function(a){}, function (a){}, function ( a , b ){}, function n(){}, function n (a){}, function  n  ( a,b ){}, function(a,){},
  function*(x){}, function * (x){}, function *(x){}, function* g(x){}, function *g(x){}, function * g (x){}, async function(x){}, async  function  (x){}, async function*(x){}, async function * g (x){},
  function (a /* first */, b // second
  ) {}, function (
    a,
    b
  ) {}, function (a)
  {}, function (a) /* nothing */ {},
  object.m, object.n, object.g, object.h, accessor(object, "x").get, accessor(object, "x").set, object["s t"], object[12], object.o, object.p,
  Kept.s, Kept.t, new Kept().both()[0], new Kept().both()[1], accessor(Kept.prototype, "y").get, Kept.prototype.m,
];
for (const form of forms) console.log(JSON.stringify(String(form)));
