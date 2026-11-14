const a0 = 3;
const skip = new Set(["length", "name", "prototype", "constructor"]);
function firstOf(holder) { const key = Reflect.ownKeys(holder).find(key => !skip.has(key)); const d = Object.getOwnPropertyDescriptor(holder, key); return d.get ?? d.set ?? d.value; }
function privateOf(read, write) { try { const it = read(); if (typeof it === "function") return it; } catch {} return null; }
const makers = [
  () => firstOf({async 	[1 + 1](
of =	[1, 2] )/**/{ return "BODY"; }
}),
  () => (function set /* c */ (/**/a/* => */) { return "BODY"; }
),
  () => firstOf({1e2( /* c */ async ,/**/\u0066g
){ return "BODY"; }
}),
  () => firstOf({async*/**/12
  (/* c */{_e /* c */ =/* => */"/*"/* c */,/**/...	type }/* => */=function(){} ){ return "BODY"; }
}),
  () => (function/**/c (	as, // c
 /* c */ )/* { */{ return "BODY"; }
),
  () => ((/* c */{k2/* { */:	{/* => */[/* ) */"k"/**/]:/* { */get/* ) */,

[
`k`/* ) */]	:x1/* => */}
  =
  'q'/* c */,/* { */[ a0  ] :
[ /* c */ /**/]/* c */,/* { */})  =>/*
*/"BODY"
),
  () => (function of/* c */(
{



}  ) { return "BODY"; }
),
  () => class { static #p// c
( /* c */ é
)// c
{ return "BODY"; }
 static take(it) { return firstOf({ get p() { return 0; } }) && (this); } static shown() { const d = this; return privateOf(() => d.#p, v => { d.#p = v; }); } }.shown(),
  () => firstOf((class {async  get

( [ /* c */ {/*
*/  },[/*
*//* c */],.../* c */await_/*
*/] =/* ) */a0// ) => {
,

é /* c */ )/* => */{ return "BODY"; }
}).prototype),
  () => firstOf({*// ) => {
0x1f/* { */( /* c */ type = x => x/* { */,	.../* { */{[ /* c */ `k`/* ) */]	: of/* c */}

) /* c */ { return "BODY"; }
}),
  () => firstOf(class {static set/* c */0x1f/* ) */({/* c */type// c
=/* c */function(){}	,/* { */...	async} /* c */ )/* c */{ return "BODY"; }
}),
  () => (async /* ) */function  x1/* ) */(	/* { */) /* c */ { return "BODY"; }
),
  () => (let_ =>/* => */"BODY"
),
  () => class { async   #p// c
(/* => */{/* ) */async:  {/* => *//* ) */}/* { */,/* { */.../* ) */a}, // c
[[ /* c */ 

]/*
*/=	a0]
)/* c */{ return "BODY"; }
 static take(it) { return firstOf({ get p() { return 0; } }) && (it); } static shown() { const d = new this; return privateOf(() => d.#p, v => { d.#p = v; }); } }.shown(),
  () => ((/**/)/* c */=>/* { */{ return "BODY"; }
),
  () => firstOf({\u006dn/* { */(/* => */) // c
{ return "BODY"; }
}),
  () => (async 	function/* => */𝓐 (// c
[  /* ) */],/* => */	)
  { return "BODY"; }
),
  () => (({  [ /* c */ `k`// c
]/* { */:// c
𝓐 /* c */ ,/*
*/c /* c */ ,/*
*/ },  ñam /* c */ =/* c */"s",  
)/* => */=> // c
{ return "BODY"; }
),
  () => (function*await_ /* c */ (/**/type/* c */,_e/* { */=/*
*/0x10  ){ return "BODY"; }
),
  () => (function/*
*//**/(/**/c
  =
a0/* ) */,...
{/* { */ /* c */ }/* { */)  { return "BODY"; }
),
  () => firstOf({async  set(
  type/* => */=0x10 ,  ñam ,  ...// ) => {
await_/* ) */)  { return "BODY"; }
}),
  () => (function  *  é(/**/_e
,...
await_/* c */){ return "BODY"; }
),
  () => firstOf(class {static/* { */\u006dn /* c */ (/* ) */{ ...// ) => {
a // c
}/* => */=
class {}

, /* c */ 𝓐 )// ) => {
{ return "BODY"; }
}),
  () => (async /* c */function	(/*
*//*
*/)  { return "BODY"; }
),
  () => firstOf((class {é/**/(	é/* => */,get = "s"/* { */)/* ) */{ return "BODY"; }
}).prototype),
  () => (function
 /* c */ ( ...

{/**/})/* ) */{ return "BODY"; }
),
  () => (a=>/* c */{ return "BODY"; }
),
  () => (function/* c */*/* c */type // c
( [let_ ,  ... // c
of/* { */]/* ) */,  {/* ) */[// c
"k"
  ] // c
: /* c */ [/*
*/ /* c */ ,...x1]  ,/* => */... // c
é }/* ) */,  ...	{/**/as/**/}	) /* c */ { return "BODY"; }
),
  () => class { #p // c
(.../* ) */of/**/){ return "BODY"; }
 static take(it) { return firstOf({ get p() { return 0; } }) && (it); } static shown() { const d = new this; return privateOf(() => d.#p, v => { d.#p = v; }); } }.shown(),
  () => (type=>"BODY"
),
  () => (async	(/* c */c= [1, 2]
  ,/* ) */ñam
  ,/* ) */type/* ) */=/* => */class {}
  ,/* ) */
  )	=>	{ return "BODY"; }
),
  () => firstOf((class {static/* { */(  [
  b, /* c */ {/* { */[ /* c */ a0] :/* { */é
  } =/* { */class {}])/*
*/{ return "BODY"; }
}).prototype),
  () => (async   (/**/get/*
*/= /* c */ (x) => x	,
c/*
*/)/**/=>{ return "BODY"; }
),
  () => firstOf((class {get 0x1f /* c */ (
  ) { return "BODY"; }
}).prototype),
  () => (function (/* => */\u0066g/*
*/=// ) => {
x => x/* ) */)/* => */{ return "BODY"; }
),
  () => firstOf({get set/* { */(/*
*/){ return "BODY"; }
}),
  () => firstOf((class {\u006dn// c
( {// c
[ /* c */ `k`/* ) */]
:{/* { */a
,	async
,	... _e }/* { */,  [a0/* ) */] :[

type /* c */ =(1, 2)/* => */]/* => */} // c
,/**/b = (x) => x // c
,/**/{/* { */[ /* c */ `k`/* => */]
: // c
get/* ) */} /* c */ ){ return "BODY"; }
}).prototype),
  () => firstOf({get/* => */[1 + 1]/* ) */(

)/* => */{ return "BODY"; }
}),
  () => firstOf({async /* c */ */* => */async/* { */(// ) => {
/* ) */)  { return "BODY"; }
}),
  () => (let_/* { */=>  "BODY"
),
  () => (async	(/* { */type	)  => "BODY"
),
  () => firstOf({get	12
  (){ return "BODY"; }
}),
  () => firstOf(class {static * ["k"]/* => */(await_ /* c */ =/* => */a0/* c */,/**/{ /* c */ 'q'	:	{	 } // c
,of=	")" }/* c */,/**/{ [/* ) */"k" /* c */ ]/* c */:  [/* ) */... // c
$d/* c */] /* c */ }// c
= function ( q ){ return q }){ return "BODY"; }
}),
  () => (function/* { */*/* c */
(\u{68}i// c
)/* ) */{ return "BODY"; }
),
  () => firstOf((class {é/* ) */(	get/* ) */,  _e
)/* ) */{ return "BODY"; }
}).prototype),
  () => (function/* => */_e  (  )// ) => {
{ return "BODY"; }
),
  () => firstOf({set

( é/* c */,/* ) */of/* c */,/* ) */{/* { */c/* { */,	async:
[// ) => {
x1,/* c */set,/* c */...
  async  ]}){ return "BODY"; }
}),
  () => (function/**/* /**/(/* { */[/*
*/{ // c
.../* ) */await_/**/}

,{
 }/* => */]
, \u{68}i =// c
[1, 2]
, {
  /* ) */} )/* => */{ return "BODY"; }
),
  () => (async /* { */function

await_(/* ) *//* { */) { return "BODY"; }
),
  () => (function	_e /* c */ (/* { */let_ /* c */ ,/* => */)

{ return "BODY"; }
),
  () => firstOf({1e2 (/**//*
*/)/* c */{ return "BODY"; }
}),
  () => class { static
get/*
*/#p
  ( /* c */ )
{ return "BODY"; }
 static take(it) { return firstOf({ get p() { return 0; } }) && (this); } static shown() { const d = this; return privateOf(() => d.#p, v => { d.#p = v; }); } }.shown(),
  () => (function/* => */x1/* c */(/**/{// ) => {
/**/},b
= /* c */ async q=>q/**/)
{ return "BODY"; }
),
  () => firstOf((class {1e2 /* c */ (// ) => {
[{
} =/*
*/function ( q ){ return q }

,/* c */\u0066g]/* { */, [
  ] /* c */ =  class { m ( q ){} }
  )

{ return "BODY"; }
}).prototype),
  () => firstOf(class {static /* c */ 12(	)// c
{ return "BODY"; }
}),
  () => firstOf((class {[1 + 1]// ) => {
( /* c */ /* { */)/* => */{ return "BODY"; }
}).prototype),
  () => ((/**//* c */)/* ) */=>
  "BODY"
),
  () => (async  /* c */ ( é, {/**/get:
  [/*
*/x1, as  ]}, [/* c *//*
*/]/**/)/* => */=> { return "BODY"; }
),
  () => firstOf({async m  (  	)// ) => {
{ return "BODY"; }
}),
  () => (async   function // c
c
(
  [ /* c */ set/* c */],// c
 )/*
*/{ return "BODY"; }
),
  () => firstOf({get// c
[ `k` ]	(/*
*/)/*
*/{ return "BODY"; }
}),
  () => firstOf((class {[1 + 1](/* => */{// ) => {
[
  "k"/* c */]/**/:/* ) */{  a/* ) */}/* => */}/* c */=a0/* ) */,

)/* c */{ return "BODY"; }
}).prototype),
  () => (function /* c */ ñam/* => */(	type = -1/**/,
...// ) => {
c
){ return "BODY"; }
),
  () => (async/* => */(/* ) */{/* c */[ 1 + 1]/* => */:	{	[ /* c */ "k"]	:

_e/* => */,[/* => */a0/* { */]:get/* => */,... b }} ,

of ,

... /* c */ {
  k  :𝓐, [/* ) */1 + 1 /* c */ ]/* c */:c/**/}/* ) */)/**/=>  "BODY"
),
  () => (async 	(

/* { */)  =>/* c */{ return "BODY"; }
),
  () => firstOf({get get /* c */ ()/* c */{ return "BODY"; }
}),
  () => (function/* { */([
  ]/* c */,_e= // c
1 /* one */ + 1/* c */,{  [
`k` /* c */ ] :// ) => {
of ,/*
*/// c
}
)/* ) */{ return "BODY"; }
),
  () => (async   function /* { */(b	,/* c */async	)/* c */{ return "BODY"; }
),
  () => (as/**/=>"BODY"
),
  () => (async	( [/**/	,	... as],/* ) */b,/* ) */{/* c */[/* c */`k`
  ]:
  _e ,/* c */.../* c */get/* { */},/* ) *//*
*/)/* => */=>{ return "BODY"; }
),
  () => firstOf({\u006dn( [
...

{as/* c */,...\u0066g  }// c
] =/=>/// ) => {
,/**/...
  let_ ) /* c */ { return "BODY"; }
}),
  () => (function é/* c */(// ) => {
_e  ="/*"
  ,/* { */set
  ,/* { */{/**/c,  "s k"/**/:await_,  ...  get/**/}
  = { }
  ,/* { *//* c */)/* { */{ return "BODY"; }
),
  () => (function	*as/**/(async,\u0066g =function(){}, )
  { return "BODY"; }
),
  () => (as/* => */=>

"BODY"
),
  () => firstOf((class {static
(// ) => {
$d // c
=/* => *//\// )  { return "BODY"; }
}).prototype),
  () => (async	(/* => */as /* c */ = ")"/*
*/,/* => */[/*
*/]/*
*/,/* => */$d// ) => {
) =>/* c */"BODY"
),
  () => firstOf({[ `k` ]/**/(  { /* c */ [/* c */1 + 1 ] /* c */ :

{// c
ñam/* => */,
k  : as/*
*/} }// c
,
[// c
.../* ) */{/* c */.../* => */𝓐 }
  ]// c
,
	)/* => */{ return "BODY"; }
}),
  () => firstOf({async m

(// c
[
 ]/**/,/**/𝓐	=/* => */async q=>q/**/,/**/{[ /* c */ `k` ] /* c */ :  {	[ // c
1 + 1]/**/: /* c */ await_  ,
  [1 + 1]
: /* c */ é

}	}=/**/[ ])/* { */{ return "BODY"; }
}),
  () => (function get/* => */(/* c */x1 )/* => */{ return "BODY"; }
),
  () => (async /**/\u0066g =>
"BODY"
),
  () => ((// c
  )=>  "BODY"
),
  () => (async   function// ) => {
async (/**/{/* => */

}/**/,{[1 + 1	]:	[ b
]}=/* { */x => x/**/,...

[/* => */as  = function(){}// c
]
){ return "BODY"; }
),
  () => ((/*
*/// ) => {
)	=>/* ) */{ return "BODY"; }
),
  () => firstOf({get ["k"](  )  { return "BODY"; }
}),
  () => (async  /* c */ (/* c */[/**//* { */]/**/)/* { */=>/**/{ return "BODY"; }
),
  () => ((
{ x1 /* c */ ,/* { */𝓐}/* => */=

{ } ,/* => */é ,/* => */ ) =>// ) => {
"BODY"
),
  () => firstOf((class {async/* { */({  /*
*/}/*
*/,/* { */{
   /* c */ }/* c */)  { return "BODY"; }
}).prototype),
  () => firstOf({set/* { */["k"]([[/* c */	]/* { */, ...
  é ]
)	{ return "BODY"; }
}),
  () => firstOf(class {static get m /* c */ (/*
*/) { return "BODY"; }
}),
  () => firstOf({*set/**/( // c
...// c
[ /* c */ 𝓐/* ) */,$d/* ) */,.../* => */as
] )// c
{ return "BODY"; }
}),
  () => ((// ) => {
$d
=[1, 2] /* c */ ,as= /* c */ a0 /* c */ ,{/* { */await_
,[ a0 // c
]:
{

type , [
`k`

]: /* c */ async
}
,/* { */}  )	=>	{ return "BODY"; }
),
  () => (async  function/* c */*
type /* c */ (/* { *//* ) */){ return "BODY"; }
),
  () => firstOf({async/* => */*/* { */12/**/(	[ // c
...
  {
1:/*
*/get
,

[a0  ]  :// c
é /* c */ }

]/* { */=/* { */a0/* ) */, { // c
}/* ) */, ...{/* => */ }/* c */){ return "BODY"; }
}),
  () => (function	type/* ) */(/* c */_e ,  {/*
*/k// ) => {
:

{/*
*//* ) */} =

/\///**/,k:/* c */{ /* c */ [// ) => {
"k"]/* => */:/* => */c// c
}/* ) */} ,  [/* => */x1,/* { */...async/* c */] ,  /* { */) /* c */ { return "BODY"; }
),
  () => firstOf((class {12 /* c */ (/* { */)  { return "BODY"; }
}).prototype),
  () => firstOf({0x1f

( /* c */ [ // c
c/* ) */,/**/b  ]/* => */,_e/* => */,await_/* => */= // c
/\///* c */)
{ return "BODY"; }
}),
  () => firstOf({static /* c */ (// ) => {
as
  ,  {// ) => {

  } = "//"
  ,  of
="s")

{ return "BODY"; }
}),
  () => firstOf(class {static/* => */set
(/* ) */[ // c
\u{68}i  ,/*
*/	],// ) => {
{k2  :  get,/**/c,/**/// ) => {
},// ) => {
x1,// ) => {
... 𝓐  )/* c */{ return "BODY"; }
}),
  () => (function
  *// ) => {
type/* => */(/* => */{[

1 + 1]	:/*
*/[/**/]  ,/* { */\u{68}i	=/* => */1  ,/* { */.../**/as// c
}// c
)// ) => {
{ return "BODY"; }
),
  () => ((	of
, ...  {.../* ) */\u0066g}// c
) =>

{ return "BODY"; }
),
  () => firstOf(class {static [ `k` ]/*
*/(// c
.../* ) */async ){ return "BODY"; }
}),
  () => firstOf({get
(/* { */ñam/* ) */,{ /* => */}/**/=/* { */"s"/**/)/* c */{ return "BODY"; }
}),
  () => (function*
  of/* { */(/**/ /* c */ )// c
{ return "BODY"; }
),
  () => (function* as(/* => */... /* c */ c) /* c */ { return "BODY"; }
),
  () => firstOf({async/* ) */*	é /* c */ (/* => */a )
{ return "BODY"; }
}),
  () => firstOf((class {get // c
m/**/(	)/* => */{ return "BODY"; }
}).prototype),
  () => class { #p

(	[ /* c */   ]/* c */)/* ) */{ return "BODY"; }
 static take(it) { return firstOf({ get p() { return 0; } }) && (it); } static shown() { const d = new this; return privateOf(() => d.#p, v => { d.#p = v; }); } }.shown(),
  () => firstOf((class {1e2 /* c */ (/* => */)	{ return "BODY"; }
}).prototype),
  () => (async function/**/*
/* { */( // c
[
  /* { */]/* ) */={ } ,  /* { */)/* c */{ return "BODY"; }
),
  () => firstOf({static
( // c
/* { */)/* { */{ return "BODY"; }
}),
  () => firstOf({set /* c */ \u006dn
(  {	c,// c
} )/* ) */{ return "BODY"; }
}),
  () => (function	_e

(/**/as // c
= -1
, // c
[// c
 ]=/*
*/(1, 2)
, // c
[

{	
}
]
, // c
 )// ) => {
{ return "BODY"; }
),
  () => ((
  [/* c */{

_e/**/}/* => */,/* ) */...{/* ) */}  ]	=/* c */"//"  , x1/* { */)  =>/* c */{ return "BODY"; }
),
  () => (function $d/* ) */( /* c */ _e/* { */)/* => */{ return "BODY"; }
),
  () => firstOf(class {static
get

1e2

()// ) => {
{ return "BODY"; }
}),
  () => firstOf(class {static	"s k" (await_/**/=/* => */1	, // c
{

\u0066g
  ,// ) => {
[/**/a0]/* c */:[// ) => {
let_/* ) */, type/* => */]
  ,// ) => {
 /* c */ }	, // c
{ /* c */ é// ) => {
=/**/[ ]/**/,/* c */𝓐// ) => {
=[1, 2]/**/,/* c *//* ) */}// c
)  { return "BODY"; }
}),
  () => (async  function
 /* c */ (  [	,/* c */{  /* => */}	]
  =/*
*/"/*"/* => */,get/* => */,...\u0066g/* { */)/*
*/{ return "BODY"; }
),
  () => (async (a	)  =>/* => */"BODY"
),
  () => (𝓐/* { */=>// ) => {
{ return "BODY"; }
),
  () => ((  ) =>/* => */"BODY"
),
  () => firstOf({set/* c */[1 + 1] // c
( {/* ) */_e,/* { */[  `k`] : b// ) => {
}/*
*/)/* => */{ return "BODY"; }
}),
  () => firstOf((class {async/**/*
  [1 + 1]( \u0066g	,/* c */of	,/* c */x1/* { */)// ) => {
{ return "BODY"; }
}).prototype),
  () => firstOf({get
  [1 + 1] // c
(// ) => {
)/* ) */{ return "BODY"; }
}),
  () => firstOf({async  *// c
m  (// c
)
{ return "BODY"; }
}),
  () => (function/**/é/* { */(
{
  /* => */}/* ) */,
  {k /* c */ :/*
*/ñam/* { */=  "//"	, let_	,  /* c */ } =/* c */class {}/* ) */,
  set

) /* c */ { return "BODY"; }
),
  () => ((/* ) */{ /* c */ [/* { */a0 /* c */ ]: \u{68}i	, await_ = // c
`${1}}`	, .../* c */as/* { */} )/* => */=>
  "BODY"
),
  () => (([
    ,	[	_e= /* c */ class {}]
=/* { *//\//
]/* c */,/* { */set/* c */,/* { */	) => /* c */ "BODY"
),
  () => firstOf({set	["k"] /* c */ (/* { */{  get/* c */:  [_e/* { */,
of/* { */,
...
  async // c
]=[1, 2]	,"s k"/* { */: // c
{
 }	, // c
}/* c */)/* ) */{ return "BODY"; }
}),
  () => firstOf({async 	static(
  as /* c */ , // c
[  ...get
] /* c */ , // c
...
  {/**/ }	) { return "BODY"; }
}),
  () => ((
  {// ) => {
.../* => */await_/* { */},/* => */$d,/* => */{/* ) */𝓐/* c */,  k // c
:

[
]/* c */=/* c *//=>//**/}
  ) => /* c */ "BODY"
),
  () => firstOf({[ `k` ] (
{
  .../**/of/* c */}// ) => {
)/*
*/{ return "BODY"; }
}),
  () => (function// ) => {
*// c
 /* c */ ({  .../* ) */c }/* c */)/* c */{ return "BODY"; }
),
  () => (function// ) => {
(	...
[_e/* => */,/**/get// ) => {
] )/* { */{ return "BODY"; }
),
  () => firstOf({async /* c */ *  12 // c
(/* ) */... { // c
...type// ) => {
} ) /* c */ { return "BODY"; }
}),
  () => (async/* => */b/* c */=>{ return "BODY"; }
),
  () => (( /* c */ await_,	{ [a0// c
]
:// c
\u0066g /* c */ },	as/* c */)/* => */=>  { return "BODY"; }
),
  () => (function let_/* => */(	_e	)/**/{ return "BODY"; }
),
  () => firstOf({async   é /* c */ (/**/ /* c */ )	{ return "BODY"; }
}),
  () => (\u{68}i => "BODY"
),
  () => (async 	function

(// ) => {
get/* ) */= { k: 1 }	,/*
*/_e
)/* => */{ return "BODY"; }
),
  () => (function/* ) */(/* c */{// ) => {
[a0]: // c
{ [`k`]/* c */:/* ) */c  ,
\u0066g  ,

}/* c */}/* ) */,{
[ `k`/* => */]// c
:/**/set // c
,// ) => {
	}/* ) */,[/* { */
]/* ) */,... // c
a
  )/* { */{ return "BODY"; }
),
  () => (function /* c */ 𝓐 (  of, as	) // c
{ return "BODY"; }
),
  () => firstOf({set 1e2 (

b

)/* c */{ return "BODY"; }
}),
  () => (𝓐 /* c */ =>	"BODY"
),
  () => (a /* c */ =>/* c */"BODY"
),
  () => firstOf({async  /* c */ \u006dn/* ) */(/*
*/)/* c */{ return "BODY"; }
}),
  () => ((/* ) */[{/* => */
}

, /* c */ 𝓐

, /* c */ ... {// c
"s k"/* c */:// ) => {
\u0066g/**/}]  ,
{/**/get/* { */: // c
type// c
,/* { */$d/* ) */}  ,
[	/* => */]  ,
...ñam/*
*/) =>{ return "BODY"; }
),
  () => (function 𝓐 ( {  /* => */} ,/* ) */c /* c */ )// c
{ return "BODY"; }
),
  () => firstOf({async*/* => */é/**/(
get/**/,$d)
{ return "BODY"; }
}),
  () => (async  /* c */ function of// ) => {
(  // c
){ return "BODY"; }
),
];
const said = async call => { try { let value = await call(); if (value && typeof value.next === "function") value = (await value.next()).value; return JSON.stringify(value) ?? "undefined"; } catch (error) { return error.name; } };
for (const make of makers) {
  const it = make();
  if (it === null) { console.log("hidden"); continue; }
  const text = String(it);
  let again;
  for (const wrap of [t => "return (" + t + "\n)", t => "return firstOf({" + t + "\n})", t => "return firstOf(class {" + t + "\n}.prototype)"]) { try { again = new Function("a0", "firstOf", wrap(text))(a0, firstOf); break; } catch {} }
  if (typeof again !== "function") { console.log("THE TEXT DOES NOT PARSE"); continue; }
  console.log(it.length === again.length, await said(() => it()), await said(() => again()), await said(() => it({}, [], 1)), await said(() => again({}, [], 1)));
}
