const a0 = 3;
const skip = new Set(["length", "name", "prototype", "constructor"]);
function firstOf(holder) { const key = Reflect.ownKeys(holder).find(key => !skip.has(key)); const d = Object.getOwnPropertyDescriptor(holder, key); return d.get ?? d.set ?? d.value; }
function privateOf(read, write) { try { const it = read(); if (typeof it === "function") return it; } catch {} return null; }
const makers = [
  () => firstOf({["k"]/* c */(	{/* c */k/**/:/* c */{ /* c */ [ `k`/* { */]/**/:/* { */$d,/*
*/[/* ) */`k`

]	:/* c */set} // c
,/* ) */[a0

]:/* => */await_  }  =  a0/* { */)	{ return "BODY"; }
}),
  () => firstOf((class {get(  {/*
*/[ /* c */ a0]:/* ) */[/* => */as/* c */=/* ) */`)`	,/* => */.../**/é] // c
, /* c */ [

"k" ]/**/:\u0066g

}=0x10/*
*/,/*
*/){ return "BODY"; }
}).prototype),
  () => firstOf({1e2
  ( $d)	{ return "BODY"; }
}),
  () => firstOf((class {set// c
0x1f // c
(/* c */{/* c */get/* ) */:  set , .../*
*/$d } /* c */ )/**/{ return "BODY"; }
}).prototype),
  () => firstOf((class {set/* { */async/* c */( // c
of
) { return "BODY"; }
}).prototype),
  () => firstOf({get/**/[ `k` ]  (  )	{ return "BODY"; }
}),
  () => (async/* c */(/**/[
  [
  // c
]

,/**/\u{68}i /* c */ = /* c */ (x) => x

,/**/...async/* c */]/*
*/=[ ])/* { */=>/*
*/"BODY"
),
  () => (async function/* ) */*// ) => {
as(	)/**/{ return "BODY"; }
),
  () => firstOf({get/* => */[1 + 1]()/* => */{ return "BODY"; }
}),
  () => (({/* { */async :[/* c */  ]=// ) => {
(x) => x
  ,	[ /* c */ `k`]
: [  _e/**/]
  ,	...as
  }/* => */,

\u0066g/* => */,

{
é/* { */= /=>//* ) */,/*
*/...// ) => {
$d/* { */})=>/**/{ return "BODY"; }
),
  () => (of =>/* { */"BODY"
),
  () => firstOf((class {get "s k" /* c */ (/* => */)
{ return "BODY"; }
}).prototype),
  () => firstOf(class {static/**/[1 + 1] /* c */ (
_e /* c */ =0x10,/* { */set// c
=class { m ( q ){} },/* { */{ /* ) */}
= `${1}}`/* c */){ return "BODY"; }
}),
  () => ((/* { */$d/* c */)=>/* ) */{ return "BODY"; }
),
  () => class { async /* ) */#p( // c
[/*
*/... { "s k"/* => */:c/* => */= /* c */ `)` }/*
*/]  =/**/"/*" ,[/*
*/.../* ) */[
/* { */]  ] ,... /* c */ é
){ return "BODY"; }
 static take(it) { return firstOf({ get p() { return 0; } }) && (it); } static shown() { const d = new this; return privateOf(() => d.#p, v => { d.#p = v; }); } }.shown(),
  () => firstOf(class {static async/* => */* /* c */ \u006dn  (/* ) */c/**/)// ) => {
{ return "BODY"; }
}),
  () => ((/* => */\u0066g/* { */=/=>/, $d, async)=> "BODY"
),
  () => firstOf(class {static/* ) */set	12/**/(
{  /* c */ } /* c */ ) { return "BODY"; }
}),
  () => (async(  await_

,/* => */.../* { */c/**/) =>/* ) */"BODY"
),
  () => firstOf({'q'/**/({ async // c
, // c
[/**/1 + 1// ) => {
]	:/* { */[// ) => {
c/* => */,
  set/* c */] // c
, // c
 /* c */ }/* c */= // c
!0)/* => */{ return "BODY"; }
}),
  () => (async function/*
*/*// c
_e/* c */(let_/* => */=  "s"// ) => {
, ... {async/* ) */:  await_

=/* { */{ k: 1 }, /* c */ set/**/="/*"}/*
*/)  { return "BODY"; }
),
  () => firstOf({set // c
[1 + 1]/* { */(/* => */as/* => */)/**/{ return "BODY"; }
}),
  () => (async /* ) */\u{68}i/* => */=>/* ) */{ return "BODY"; }
),
  () => (a	=> "BODY"
),
  () => firstOf({async /* c */ * /* c */ set  (  \u0066g/**/=
")"/**/)/* { */{ return "BODY"; }
}),
  () => (function/* ) */as(
[

{await_// ) => {
,
  ...	type}	,/* ) */...𝓐/* ) */],/* ) */[async,{_e/*
*/,/* c */async:/* => */of}/* { */]=  [1, 2],/* ) */)/* => */{ return "BODY"; }
),
  () => (async (

of // c
)=>/* { */{ return "BODY"; }
),
  () => (function/* { *//* { */( /* c */ [// c
,/* c */..._e ] // c
,/* c */b // c
,/* c */ /* c */ ) { return "BODY"; }
),
  () => firstOf(class {static/**/1e2/* => */( a /* c */ =/**/class { m ( q ){} }	)

{ return "BODY"; }
}),
  () => (b=>/* { */"BODY"
),
  () => firstOf({get/* c */static
() // c
{ return "BODY"; }
}),
  () => firstOf({get/* { */"s k"(/**/) { return "BODY"; }
}),
  () => firstOf((class {m /* c */ (/*
*/\u0066g/* => */=")",/* ) */[/* c */],/* ) */ /* c */ )/* c */{ return "BODY"; }
}).prototype),
  () => (a	=>// c
"BODY"
),
  () => firstOf(class {static async/**/(/**/{
  }  ,/* => */c// ) => {
=1
) { return "BODY"; }
}),
  () => (x1 =>
{ return "BODY"; }
),
  () => (function/* ) */* of/*
*/(
\u0066g
=
  `${1}}`	)/**/{ return "BODY"; }
),
  () => ((/* c */ñam,	{["k"]/* => */:
{

...
  𝓐  }/* ) */,	[/* => */"k"/* { */]	:/*
*/async/* ) */,	/* { */}	)/* c */=>/* { */"BODY"
),
  () => firstOf(class {static get	[ `k` ]/* ) */(/* c */) { return "BODY"; }
}),
  () => firstOf((class {"s k"  ( /* c */  ) { return "BODY"; }
}).prototype),
  () => firstOf({12/* => */( \u0066g,  set /* c */ = a0)/**/{ return "BODY"; }
}),
  () => (async /**/(/*
*/type/*
*/)/* { */=>/* => */{ return "BODY"; }
),
  () => class { static/* c */get/* c */#p
  (// c
) { return "BODY"; }
 static take(it) { return firstOf({ get p() { return 0; } }) && (this); } static shown() { const d = this; return privateOf(() => d.#p, v => { d.#p = v; }); } }.shown(),
  () => firstOf({set/* => */12 (

{	get/**/: /* c */ {// ) => {
["k"]
:// ) => {
c }/* c */,/* { */[/* ) */`k`/* ) */]/* c */:/* { */[	\u{68}i/* c */=/**/1e3/*
*/,/* ) */.../* => */x1 /* c */ ]/* c */,/* { */	} )
{ return "BODY"; }
}),
  () => (async/* c */(

_e/* { */=/**/-1) =>/* c */{ return "BODY"; }
),
  () => firstOf({set m/* ) */(

$d/**/)/* { */{ return "BODY"; }
}),
  () => (async /* { */function /**/(type=/*
*/!0// c
)
  { return "BODY"; }
),
  () => (get/* { */=>/* { */{ return "BODY"; }
),
  () => class { get #p
(
  ){ return "BODY"; }
 static take(it) { return firstOf({ get p() { return 0; } }) && (it); } static shown() { const d = new this; return privateOf(() => d.#p, v => { d.#p = v; }); } }.shown(),
  () => ((/**/_e/* => */=a0,  {/* c */},  [a ,/* { */{[ a0// ) => {
] /* c */ :x1/* { */}/* { */=/* ) *//=>//* => */]/*
*/) => { return "BODY"; }
),
  () => (x1 =>/**/{ return "BODY"; }
),
  () => ((// ) => {
[ /* c */ {/**/}
], /* c */ {/* ) */["k"/* => */]// c
:// c
{/* => */of/*
*/,	[
1 + 1/*
*/]
  :/* => */b
  },...
type
}
  )/* c */=>  "BODY"
),
  () => (function/**/*as /* c */ (// ) => {
[// ) => {
/* { */] // c
=/**/"//"/* { */, /* c */ \u{68}i
=  "//"
)
  { return "BODY"; }
),
  () => firstOf(class {static async/**/*[1 + 1] (/**/...// ) => {
x1) { return "BODY"; }
}),
  () => ((  [ 
  ]/**/= /* c */ x => x// ) => {
,/* { */b// ) => {
,/* { *//* ) */)=>/* c */"BODY"
),
  () => (function

* // c
/* => */( // c
ñam= // c
async q=>q , é= /* c */ function ( q ){ return q }/* => */){ return "BODY"; }
),
  () => ((/* ) */é/* => */=  /\//,/* { */{// c
let_

=
/=>/,

[	1 + 1/* c */] : { [// c
1 + 1 ]:/* { */_e,/* => */[/* ) */a0

]/* c */:	as },

...set/* { */},/* { */{/*
*/[  a0 ] :  {
/* c */}/* ) */}/* { */)=>	{ return "BODY"; }
),
  () => firstOf({*"s k"	(/* c */	)	{ return "BODY"; }
}),
  () => firstOf({get// ) => {
"s k"/* => */(
){ return "BODY"; }
}),
  () => class { static/*
*/#p/* { */(  ){ return "BODY"; }
 static take(it) { return firstOf({ get p() { return 0; } }) && (this); } static shown() { const d = this; return privateOf(() => d.#p, v => { d.#p = v; }); } }.shown(),
  () => firstOf((class {get é/* ) */(/* ) */)/* c */{ return "BODY"; }
}).prototype),
  () => (function */**/(/* c */.../*
*/await_/**/) { return "BODY"; }
),
  () => ((   ) /* c */ =>/* c */{ return "BODY"; }
),
  () => (( /* c */ [
  ])=>{ return "BODY"; }
),
  () => firstOf((class {set
async (é/* => */){ return "BODY"; }
}).prototype),
  () => (async  function /* c */ *
  (/* => */{/* { */}/* => */=/* { */async q=>q)	{ return "BODY"; }
),
  () => ((
{/* => */[/**/a0/* c */]/* ) */: []/* => */}/* => */,

é =/* => */0x10/* => */,

await_ /* c */ )	=>
  "BODY"
),
  () => firstOf((class {get// c
set /* c */ ( ){ return "BODY"; }
}).prototype),
  () => firstOf({set/* => */é( /* c */ a)	{ return "BODY"; }
}),
  () => firstOf({*  set /* c */ (
  get  ,	\u0066g/* => */){ return "BODY"; }
}),
  () => (async function/**//* => */( /* => */)// c
{ return "BODY"; }
),
  () => ((of  )	=>{ return "BODY"; }
),
  () => (async/* ) */\u{68}i/* { */=>// ) => {
{ return "BODY"; }
),
  () => (\u0066g /* c */ =>/* => */{ return "BODY"; }
),
  () => (function/*
*/// ) => {
( {async
,
/* { */} = /* c */ (x) => x // c
, {
} // c
, b) /* c */ { return "BODY"; }
),
  () => (async /* c */ (

...\u{68}i /* c */ )	=>  "BODY"
),
  () => firstOf((class {[ `k` ] ( /* c */ é
  ,  set

=  [ ]
  ,  ...	\u{68}i/* c */){ return "BODY"; }
}).prototype),
  () => (function get/**/(/* => */[/**/type  ]/* => */)	{ return "BODY"; }
),
  () => ((

/* { */)/* => */=>{ return "BODY"; }
),
  () => (async /**/function of/* ) */(/* ) */\u{68}i/**/=/* c */x => x// ) => {
)
{ return "BODY"; }
),
  () => firstOf({async*/* ) */[1 + 1](  [ /* c */ ]
,{\u0066g// c
= async q=>q/* => */, let_

=	function(){}/* { */}
,.../**/set) { return "BODY"; }
}),
  () => firstOf(class {static/**/1e2 (/* c */{ async	:{ [// c
"k"]/* => */:type ,
.../* => */a // c
}},  await_,  ñam
) { return "BODY"; }
}),
  () => firstOf((class {* /* c */ 1e2/* => */( // ) => {
) { return "BODY"; }
}).prototype),
  () => (function/* c */let_ /* c */ ( // c
	)
{ return "BODY"; }
),
  () => class { #p (	_e /* c */ =/* c */a0/* => */,/* => */b
=
function ( q ){ return q }/* => */,/* => */...  \u0066g/*
*/)/**/{ return "BODY"; }
 static take(it) { return firstOf({ get p() { return 0; } }) && (it); } static shown() { const d = new this; return privateOf(() => d.#p, v => { d.#p = v; }); } }.shown(),
  () => (function/*
*/type
  ( ...// ) => {
_e // c
){ return "BODY"; }
),
  () => (function // c


( /* c */ of  =/[)]/,/* c */let_=/* ) */"s"
  ){ return "BODY"; }
),
  () => ((
[/**/{ $d ,/* => */1	:  𝓐// c
=/* { */"//"/* ) */}/* c */,/* ) */  ]
,[  /* c */ ]
,set=

!0
,.../* => */async/* => */)=> /* c */ { return "BODY"; }
),
  () => (function/**/ñam	(/*
*/[ /* c */ {// ) => {
/* => */}
,
 /* c */ ]// c
,/**/{

k2 /* c */ :/* ) */c/*
*/}) { return "BODY"; }
),
  () => firstOf({set ["k"]/**/(b )// ) => {
{ return "BODY"; }
}),
  () => firstOf({set set/* => */(/* => */async)/*
*/{ return "BODY"; }
}),
  () => (a/**/=>/* ) */{ return "BODY"; }
),
  () => (function/**/a /* c */ (/* { */
)/* => */{ return "BODY"; }
),
  () => (𝓐/* => */=>
  "BODY"
),
  () => firstOf(class {static async  "s k" (  [/* { */b /* c */ = // c
null/* { */, // c
{.../* { */é } ], [/* => */[/* { */... // c
as]/* => */], [	[ /* c */ x1// ) => {
=class { m ( q ){} }/*
*/]=
{ }/* { */,/* { */[/* c */a/**/]])// c
{ return "BODY"; }
}),
  () => (function*
  (/* ) */)	{ return "BODY"; }
),
  () => (get/* ) */=>  { return "BODY"; }
),
  () => firstOf({async (/* { */)/* ) */{ return "BODY"; }
}),
  () => (async  function/* c */ /* c */ (/* { */{
 }/* { */,	{/*
*/[ /* c */ "k"
] : [let_ // c
]/* ) */,/*
*/[`k`// c
]/* c */:/**/[async// ) => {
,// c
b/* ) */]/* => */} )

{ return "BODY"; }
),
  () => (function/* c */\u0066g(/**/{
[ 1 + 1 ] // c
:[ await_/* ) */] /* c */ }// c
,

{/* c */[ // c
a0]/* { */:[ /* c */ /* c */, // c
\u{68}i// ) => {
=null  ]// ) => {
,  [/* { */`k`/* => */] : b// ) => {
,  ...let_/* { */}// c
,

{		}// c
,

.../* c */é
) /* c */ { return "BODY"; }
),
  () => (function  (/* { */_e	=[ ]	){ return "BODY"; }
),
  () => class { static

get #p
  ( )/* ) */{ return "BODY"; }
 static take(it) { return firstOf({ get p() { return 0; } }) && (this); } static shown() { const d = this; return privateOf(() => d.#p, v => { d.#p = v; }); } }.shown(),
  () => (function/* { */a(	[/* { */𝓐	="/*"// c
,/**/...  type
]/* { */,// ) => {
let_/* c */=/*
*/"/*")/*
*/{ return "BODY"; }
),
  () => ((/*
*/[
[/* { */a	,
  $d/* => */] /* c */ =/*
*/'q', // c
\u{68}i/* ) */]/* => */,
  { [/*
*/`k`/* => */]/* c */:{// c
'q' :é =0x10 } // c
}

=/* c *//\//	)/* ) */=>	{ return "BODY"; }
),
  () => (function  \u0066g /* c */ (	/* ) */){ return "BODY"; }
),
  () => (async function(/**/

)/*
*/{ return "BODY"; }
),
  () => (async /**/function/* => */async/*
*/(
  /* ) */)
{ return "BODY"; }
),
  () => (( async/* { */=  { } /* c */ ,// c
await_	=a0 /* c */ ,// c
) /* c */ =>{ return "BODY"; }
),
  () => (async function ñam
( /* c */ é/* => */,/* c */)/* c */{ return "BODY"; }
),
  () => (function /* c */ 
(/* => */{

}// ) => {
,{/* c */1:a  ,[/* { */`k`
  ]
  :𝓐  ,/* ) */}// ) => {
,[	...	{ // c
...b
}

]/**/){ return "BODY"; }
),
  () => (function	\u{68}i/* ) */(
)// ) => {
{ return "BODY"; }
),
  () => firstOf(class {static
async */* => */[1 + 1]  (.../* c */set/*
*/)/* { */{ return "BODY"; }
}),
  () => firstOf({async  [1 + 1](/* => */x1=/**/[ ]/* c */)/*
*/{ return "BODY"; }
}),
  () => firstOf({static
({
type, ...é }/* c */,
  \u{68}i/* c */,
  ñam/* c */,
  ...
{	get /* c */ ,[/* { */1 + 1/*
*/]  :/* ) */a /* c */ }/**/)/* => */{ return "BODY"; }
}),
  () => (async /**/function*
  get	(/**/{
c ,/* ) */}	=/* c */function(){}// c
)  { return "BODY"; }
),
  () => (function  é/**/(// c
𝓐	,	await_	,	x1/* c */=
  1 /* one */ + 1  )  { return "BODY"; }
),
  () => ((
) /* c */ =>/*
*/"BODY"
),
  () => firstOf((class {é // c
( as// c
="s" ) { return "BODY"; }
}).prototype),
  () => firstOf((class {async/* c */*"s k"// ) => {
(/* => */{  b  ,
  set } ,/*
*/as)/**/{ return "BODY"; }
}).prototype),
  () => (function * /* ) */(	b ,// c
[ /* c */ x1/**/=/*
*//[)]//*
*/,/* ) */ñam/* => */=/* { */-1/* ) */]=/* => */"/*" ,// c
as // c
=/* { */null ,// c
.../* c */[c/* ) */=/* => */[ ]/* ) */]/**/)// c
{ return "BODY"; }
),
  () => (( \u{68}i, {

[  "k" /* c */ ]:/*
*/b// ) => {
}, a
)	=> /* c */ "BODY"
),
  () => ((/* c */ñam// c
,/* ) */$d
=
1 /* one */ + 1// c
,/* ) */_e/* c */)	=>
  "BODY"
),
  () => ((/*
*//* ) */) =>/* ) */{ return "BODY"; }
),
  () => firstOf((class {*[ `k` ]/* ) */(
{/* { */k/* { */:{ /**/} =/* { */null/* c */,'q'/**/: c	=/* { *//[)]//* c */,...	set // c
}	)/*
*/{ return "BODY"; }
}).prototype),
  () => firstOf(class {static é/* c */( )/* ) */{ return "BODY"; }
}),
  () => ($d  =>{ return "BODY"; }
),
  () => (( /* c */ ) => /* c */ "BODY"
),
  () => (async  function/* { */set  ([ /* c */ ]/**/=/* ) */[ ]/*
*/,/* { */{ $d
  } =  (1, 2)/*
*/,/* { */await_
) { return "BODY"; }
),
  () => (function
ñam(/* c */ /* c */ )  { return "BODY"; }
),
  () => firstOf({get 'q'/* ) */(/* => */)  { return "BODY"; }
}),
  () => (async /* { */function // c
let_ (
  $d , /* c */ \u0066g , /* c */ [
get,/**/a,/**/... { /* c */ [ /* c */ 1 + 1/* { */] :  x1 ,as/* { */} ] // c
){ return "BODY"; }
),
  () => class { static // c
set
#p({// c
/* => */}){ return "BODY"; }
 static take(it) { return firstOf({ get p() { return 0; } }) && (this); } static shown() { const d = this; return privateOf(() => d.#p, v => { d.#p = v; }); } }.shown(),
  () => firstOf((class {\u006dn/*
*/(/**/get
,/* => */\u{68}i
,/* => */[/* => */,[
a// ) => {
= "/*"	] ]
,/* => */
  )	{ return "BODY"; }
}).prototype),
  () => (async /* => */function _e// c
( /* c */ {	async // c
:/**/𝓐
  =/* c */"/*"	,/* ) */\u{68}i	,/* ) */...// c
a/*
*/}/* ) */){ return "BODY"; }
),
  () => (async /* => */x1/* c */=> "BODY"
),
  () => (set=>/**/{ return "BODY"; }
),
  () => (async/* => */type	=>
  { return "BODY"; }
),
  () => ((as  ,  {[/* ) */a0]/* ) */:{/* { */[`k`// ) => {
]/**/:/* c */x1 /* c */ }/* c */,  get=  class { m ( q ){} }}// c
)  =>
  "BODY"
),
  () => firstOf({get /* c */ ({    }=/* { */`${1}}`,// c
[/* c */  ]/* => */="s"/* => */)  { return "BODY"; }
}),
  () => ((
  {
k2/**/:{/**/k// c
:/* ) */await_/**/,...get  }	=  /[)]/, async:/* { */{	𝓐
}, } ,  { // c
... type
} ,  [// c
[/* c */ // c
]/* => */,
[   /* c */ ]/**/]  = /* c */ { } ,  /*
*/) =>"BODY"
),
  () => firstOf((class {* "s k"/* { */({ [// c
`k`

]/*
*/:	async/* => */} , {/* ) */k2/* => */:/**/𝓐/* { */=	'q'/* ) */,
'q'  :/**/let_ /* c */ } ) { return "BODY"; }
}).prototype),
  () => firstOf({m
(	[] // c
,
  ...  ñam/* ) */)/*
*/{ return "BODY"; }
}),
  () => (function/* c *//* => */(
$d/* c */,/* ) */{// ) => {
type,/* ) */[`k`/*
*/]/* => */:
{/* { */[a0 // c
]  :// ) => {
x1 ,// c
0x1: // c
\u{68}i ,// c
/* c */},/* ) */ // c
}	)/* => */{ return "BODY"; }
),
  () => (function/* => */let_ // c
(/* { */{[ // c
"k"/* { */]:{/**/// c
}} /* c */ ,
... /* c */ c ){ return "BODY"; }
),
  () => (function/* c */*

_e/**/(
  {...await_ /* c */ }/* { */,// ) => {
c/* { */,// ) => {
{}=

{ }/* { */,// ) => {
// ) => {
){ return "BODY"; }
),
  () => ((  async// ) => {
=// ) => {
null /* c */ ,ñam/* => */=  "s" /* c */ ,/* { */)	=>"BODY"
),
  () => firstOf((class {get/* c */["k"] // c
(/* { */) { return "BODY"; }
}).prototype),
  () => (function*/* c */ñam (
{ get
:{

$d ,// ) => {
	} =(x) => x/* => */,get  : // c
type/* => */,.../* { */_e }/**/= [ ],/* => */{ // c
[a0 ]/* c */:
  async,
  [1 + 1
  ] // c
:c/* { */}	){ return "BODY"; }
),
  () => ((/* => */x1,/*
*/let_,/*
*/\u0066g= /[)]/)/* ) */=>
{ return "BODY"; }
),
  () => firstOf((class {* [1 + 1] /* c */ ([/* { *//* ) */]
  ,

let_

) // c
{ return "BODY"; }
}).prototype),
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
