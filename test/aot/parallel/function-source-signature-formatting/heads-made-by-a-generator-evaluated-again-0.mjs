const a0 = 3;
const skip = new Set(["length", "name", "prototype", "constructor"]);
function firstOf(holder) { const key = Reflect.ownKeys(holder).find(key => !skip.has(key)); const d = Object.getOwnPropertyDescriptor(holder, key); return d.get ?? d.set ?? d.value; }
function privateOf(read, write) { try { const it = read(); if (typeof it === "function") return it; } catch {} return null; }
const makers = [
  () => (async (
é // c
= [1, 2] /* c */ ,// c
{/* { */1:/* { */get= /* c */ { }
  ,/**/} /* c */ ,// c
[/* c */type /* c */ ,
  \u0066g /* c */ ,
  ...\u{68}i/*
*/]/* => */=")"/* { */) => /* c */ { return "BODY"; }
),
  () => firstOf((class {async *// ) => {
\u006dn// c
(  await_/* => */,[	]/* => */,[// ) => {
ñam/*
*/]	)	{ return "BODY"; }
}).prototype),
  () => firstOf((class {[ `k` ] (a/* c */=/* c */0x10
,/* ) */{/* => */[/* => */"k" /* c */ ]
  :/**/[ /* c */ /* ) */] /* c */ }/* { */= // c
!0
,/* ) */{ of,/* { */[ 1 + 1	]: /* c */ [/**//*
*/]/* ) */} /* c */ =	/=>//**/)/* => */{ return "BODY"; }
}).prototype),
  () => (async ( /* c */ { /* c */ [ /* c */ "k"]:// ) => {
{  /**/}/* => */,/* => */"s k" :	\u{68}i/* => */=/* ) */{ k: 1 }/* => */,/* => */...let_}/* c */)/* { */=>/* c */{ return "BODY"; }
),
  () => firstOf((class {set	'q'/* c */({of,// c
[ /* c */ `k`/* { */] /* c */ : /* c */ {k2 :get=function(){}
  }}/*
*/)/* => */{ return "BODY"; }
}).prototype),
  () => (function */**/( /* c */ {[/* ) */"k"/* => */]/* c */:	{ 	}// ) => {
},/* { */get,/* { */	)
  { return "BODY"; }
),
  () => (function 

(/*
*/) { return "BODY"; }
),
  () => firstOf({async  /* c */ é/**/( /* c */  ){ return "BODY"; }
}),
  () => firstOf((class {get // c
( // c
[ // c
[/* c */get /* c */ ,/**/c/* c */]/* => */, /* c */ {	ñam/*
*/,/* { */x1	= async q=>q/*
*/,/* { */ }/**/=
function(){}	]/* => */,/* => */as/* => */,/* => */...
{/* c */})/**/{ return "BODY"; }
}).prototype),
  () => (function// ) => {
of/*
*/(  [/* ) *//* { */],	[ /* c */ ],	{
[/* c */a0
]/* c */:[/* { */	]	,  ...
x1	}/* { */)
  { return "BODY"; }
),
  () => firstOf({async/* c */*/* c */12(/**/async	=/**/")"  ,set  ,get)/**/{ return "BODY"; }
}),
  () => (function// ) => {
c/* c */(/**//* => */)/**/{ return "BODY"; }
),
  () => (function/* ) */  (  let_// c
=")"// c
, /* c */ set/* => */=/* ) */`${1}}`/* { */)// ) => {
{ return "BODY"; }
),
  () => (function/* c */type/**/([	_e/* => */= /* c */ "/*"/* ) */]=/* c */")" ,/**/.../* => */$d )/**/{ return "BODY"; }
),
  () => ((
{  /* => */} /* c */ ) /* c */ =>"BODY"
),
  () => (async /**/function/* c */*/* c */$d (/* ) */{ [a0  ]/* => */: {/**/\u{68}i ,
[	a0/**/]: /* c */ b ,
}/* ) */, /*
*/},é	= /* c */ ")")/* ) */{ return "BODY"; }
),
  () => (as=>/**/"BODY"
),
  () => (function
x1	(// ) => {
async/**/){ return "BODY"; }
),
  () => firstOf({async(
{/* c */of	,
[1 + 1/* => */] : /* c */ [/* => */get/* { */=/* ) *//\//
  ,// ) => {
\u0066g/* ) */=/* => */class {} ]	,
...let_
}=// c
x => x	) // c
{ return "BODY"; }
}),
  () => ((/* c */await_= /* c */ a0 // c
,/* c */[
{[// ) => {
1 + 1/* => */]// ) => {
:  as	,// ) => {
.../* { */of  },/**/\u0066g =/* { */function ( q ){ return q },/**/... set  ]
=
async q=>q // c
,/* c */{
\u{68}i }  =/* { */class { m ( q ){} }/* => */)=> "BODY"
),
  () => (async 	function	
  (/* c */get
, /* c */ as/*
*/)

{ return "BODY"; }
),
  () => firstOf({0x1f	( // c
)/**/{ return "BODY"; }
}),
  () => firstOf((class {["k"] (	{/*
*/set/**/, k/* ) */:/* c */let_  }	=/* ) */function(){} ,
  {// ) => {
0x1/**/:	[a/* ) */, ...b// ) => {
]/**/,
k/**/:/* ) */of }=/* ) */class { m ( q ){} })	{ return "BODY"; }
}).prototype),
  () => class { async #p// c
(	\u{68}i/* c */=null,/*
*/) /* c */ { return "BODY"; }
 static take(it) { return firstOf({ get p() { return 0; } }) && (it); } static shown() { const d = new this; return privateOf(() => d.#p, v => { d.#p = v; }); } }.shown(),
  () => ((/**/b
  , [/*
*/])=> /* c */ { return "BODY"; }
),
  () => (function// ) => {
/* c */(  \u0066g= // c
"/*"  , // c
[// ) => {
,// ) => {
[/* c */]/* => */]/* => */) /* c */ { return "BODY"; }
),
  () => (function/* { */let_/* ) */(/* { */_e , /* c */ {.../**/\u{68}i  })/* => */{ return "BODY"; }
),
  () => (async /**/a/* => */=>

{ return "BODY"; }
),
  () => ((  )/* c */=> "BODY"
),
  () => firstOf({get/* c */set (  ){ return "BODY"; }
}),
  () => (function 𝓐// ) => {
(/* c */{/* => */k/**/:b }/* ) */, /* c */ [/* => */// c
]){ return "BODY"; }
),
  () => ((	)	=>	"BODY"
),
  () => firstOf(class {static /* c */ async*/**/["k"]	( /* c */ {
[	1 + 1/* { */]	: [// c
/* => */]/* => */,
  of/* => */,
  ...get /* c */ }/*
*/, // c
){ return "BODY"; }
}),
  () => ((/* { */as
) =>/* ) */{ return "BODY"; }
),
  () => firstOf({get [1 + 1]/* { */()  { return "BODY"; }
}),
  () => class { get/* => */#p /* c */ (// c
)/*
*/{ return "BODY"; }
 static take(it) { return firstOf({ get p() { return 0; } }) && (it); } static shown() { const d = new this; return privateOf(() => d.#p, v => { d.#p = v; }); } }.shown(),
  () => ((/* => */)	=>
  "BODY"
),
  () => firstOf({get // c
static/*
*/(){ return "BODY"; }
}),
  () => class { set  #p(/**/x1/* c */)/**/{ return "BODY"; }
 static take(it) { return firstOf({ get p() { return 0; } }) && (it); } static shown() { const d = new this; return privateOf(() => d.#p, v => { d.#p = v; }); } }.shown(),
  () => firstOf((class {set
"s k"/* c */({[
  a0 /* c */ ] :/**/b/* ) */, /* c */ async /* c */ :get } /* c */ ){ return "BODY"; }
}).prototype),
  () => (function/**/(/* c */... type/**/)/* c */{ return "BODY"; }
),
  () => (function
\u0066g
(

𝓐){ return "BODY"; }
),
  () => ((	of // c
,b
  ) /* c */ =>{ return "BODY"; }
),
  () => firstOf({*/* c */é  (
  {[/**/"k"
  ] :𝓐 ,// ) => {
[/* ) */1 + 1/**/]

:await_ ,// ) => {
/* => */}// ) => {
){ return "BODY"; }
}),
  () => ((
{	0x1/**/:/**/as, /* c */ [ /* c */ 1 + 1/* { */]
:/* c */{[ // c
"k"]/* c */:	await_

} }/**/,
/* { */) => "BODY"
),
  () => (function type/*
*/(/* { */[  ],a,{ [1 + 1
]/* { */:
{[/* => */a0/*
*/]	:/* ) */ñam/* c */,get:

_e
=/* => *//[)]//* c */,...get }/* => */,
k:/* { */[  // c
] }, ) { return "BODY"; }
),
  () => (function/**/*  as/* => */(

[/* => */... /* c */ async
  ]
=/* => */[1, 2]
,/*
*/[
,.../**/[ /* c */ _e ,// ) => {
let_/* c */=(x) => x /* c */ ] // c
]
) /* c */ { return "BODY"; }
),
  () => (function/* c */of/* ) */(/* c */[\u0066g=/* c */null	,{	  } /* c */ = /=>//**/]/* c */,// c
async =/*
*/0x10/* c */,// c
{ 0x1 /* c */ :// ) => {
[

b]}

=/* { */!0	)/* { */{ return "BODY"; }
),
  () => (async(	)/**/=>{ return "BODY"; }
),
  () => firstOf({async é/* => */(
  type/* c */)// c
{ return "BODY"; }
}),
  () => ((  \u{68}i/*
*/=/*
*/!0)	=>/* ) */{ return "BODY"; }
),
  () => firstOf((class {'q'/* ) */($d  = /* c */ /\///**/,

{	k/* { */:/**/a/* => */}/**/,

set/* c */){ return "BODY"; }
}).prototype),
  () => class { #p// ) => {
({/* { */...type}
,  as
,  {/**/[/* ) */1 + 1]: // c
{[`k`
]/* => */:/* c */_e  }}/* ) */){ return "BODY"; }
 static take(it) { return firstOf({ get p() { return 0; } }) && (it); } static shown() { const d = new this; return privateOf(() => d.#p, v => { d.#p = v; }); } }.shown(),
  () => (function	* 
([ // c
  ] /* c */ )/* ) */{ return "BODY"; }
),
  () => (async  ( 
  )=>// c
{ return "BODY"; }
),
  () => (async  (
await_/* => */= // c
function(){}
,/**/_e
,/**/c = 1e3
  )=> /* c */ "BODY"
),
  () => firstOf((class {set/* => */get/* { */(  𝓐/* c */)/* ) */{ return "BODY"; }
}).prototype),
  () => (function	*  c (	set /* c */ =
"s" ,/* { */{ /* c */ [ /* c */ `k` /* c */ ]/**/:/* { */b
, /* c */ 

} ,/* { */{\u0066g /* c */ ,/* => */... let_ // c
} ){ return "BODY"; }
),
  () => firstOf({async 	get	({
async/* ) */: /* c */ get  =`${1}}` // c
, /* c */ } /* c */ )// c
{ return "BODY"; }
}),
  () => ((

\u{68}i/**/,/*
*/as/**/,/*
*/{$d ,	[/*
*/1 + 1 ] :[  /* c */] ,	...	𝓐/**/}/* ) */)	=> /* c */ "BODY"
),
  () => (b=>/* ) */"BODY"
),
  () => (function/*
*/*c ( /* c */ await_  ,	... /* c */ [// ) => {
  ,/* c */ // c
]  ) /* c */ { return "BODY"; }
),
  () => (function // c
({	set =// c
class { m ( q ){} } ,/*
*/type =/*
*/{ }
  } =/* { *//[)]//* c */,  [\u0066g ]// ) => {
=// c
null/* c */,  [
  \u{68}i
  ,/*
*/...
{/**/

}/**/] = 1/* c */,  /* ) */)/* => */{ return "BODY"; }
),
  () => (function/* ) */\u{68}i	( [/* ) */ // c
] /* c */ ,b/* ) */=/* c */0x10// c
){ return "BODY"; }
),
  () => firstOf((class {get set /* c */ ( // c
)/* => */{ return "BODY"; }
}).prototype),
  () => firstOf({get/* { */m/**/(){ return "BODY"; }
}),
  () => (async/* c */(/* { */{/* { */1 :
  { [/* c */`k`/**/] : /* c */ é// ) => {
,/*
*/async  :	$d=/* ) */[1, 2]/* => */} // c
,	[a0	] :

let_ // c
,	...set},	\u{68}i/* c */)=>
{ return "BODY"; }
),
  () => (function
  /*
*/( )/* => */{ return "BODY"; }
),
  () => ((/* c */[/* => */c/**/]/* ) */, {
𝓐/* { */,  0x1/**/:of/* c */}	)  =>/* => */"BODY"
),
  () => (function */* { *//* => */( b/* { */=/**/async q=>q/* c */,
let_
)/* => */{ return "BODY"; }
),
  () => firstOf((class {get/* { */'q'/* c */(
) /* c */ { return "BODY"; }
}).prototype),
  () => firstOf((class {*m/**/(/* ) */{/*
*/[/**/a0 ]/* c */:{// ) => {
// ) => {
}// c
} =// c
a0  ,[	[/**/

] ]/*
*/) /* c */ { return "BODY"; }
}).prototype),
  () => firstOf({*
é(...	$d/*
*/)

{ return "BODY"; }
}),
  () => (async /* c */function  a
  (/**/c/* => */=
(x) => x, [// ) => {
{	\u0066g/* => */,/* => */x1/* ) */}/**/=  { k: 1 }, [/* ) */ ]	= "//"/* => */]=/* => */x => x, ...  let_
  )// ) => {
{ return "BODY"; }
),
  () => ($d =>"BODY"
),
  () => (async  function/* c */* of /* c */ (/* c */)/* { */{ return "BODY"; }
),
  () => (set  =>/* { */"BODY"
),
  () => firstOf({get "s k"// ) => {
(
){ return "BODY"; }
}),
  () => firstOf({set/**/["k"]( { [ 1 + 1 ]
: await_	,/**/.../* { */\u{68}i } /* c */ ){ return "BODY"; }
}),
  () => ((
type)/* => */=>
"BODY"
),
  () => (é/* c */=>"BODY"
),
  () => firstOf({get get(
  ) // c
{ return "BODY"; }
}),
  () => firstOf({async /* { */async
(/**/[/* c */𝓐 /* c */ ,/* { */.../* { */[  ñam/* => */, \u0066g/* => */, ... get	]/* => */]
,/* => */\u{68}i
,/* => */{/* c */[/* ) */a0 ]
  :/* { */{	.../* { */é /* c */ }
,/**/get :/* ) */b=
function(){}

}// ) => {
)// ) => {
{ return "BODY"; }
}),
  () => ($d/* c */=>

{ return "BODY"; }
),
  () => firstOf({async /* c */ *["k"]
( $d/* c */="//",
  { // c
},
  \u{68}i/* ) */) { return "BODY"; }
}),
  () => (function// ) => {
get/**/( _e// ) => {
=
(1, 2)/* ) */,x1/* ) */,

){ return "BODY"; }
),
  () => ((
𝓐
, as)/* { */=>/* => */{ return "BODY"; }
),
  () => (( ñam,type  =/*
*/1/* c */) /* c */ => // c
{ return "BODY"; }
),
  () => (async  (
{ [`k`]/**/:as

}

,/*
*/{ // c
[/* c */1 + 1 ]
:  async/* ) */}

,/*
*/[/* c */c/*
*/= /=>//* ) */]/* ) */)/* c */=> // c
"BODY"
),
  () => (function/* => */as	( /* c */ c, /* c */ $d/* ) */= function(){} // c
)	{ return "BODY"; }
),
  () => firstOf({async /* ) */é(// c
{/*
*//**/}

= -1/* c */,// ) => {
[   // c
] =/* => */{ k: 1 }/* { */)  { return "BODY"; }
}),
  () => (async /**/\u{68}i=> // c
"BODY"
),
  () => (function/* ) */*// c
 (
   )	{ return "BODY"; }
),
  () => ((/**/[// ) => {
\u0066g/* { */]
  ,type
  ,
)=>  { return "BODY"; }
),
  () => class { static */* => */#p/* ) */(... get

)  { return "BODY"; }
 static take(it) { return firstOf({ get p() { return 0; } }) && (this); } static shown() { const d = this; return privateOf(() => d.#p, v => { d.#p = v; }); } }.shown(),
  () => (( $d ,...// ) => {
type)/* ) */=>/* c */"BODY"
),
  () => firstOf({set/* => */\u006dn ({


}) { return "BODY"; }
}),
  () => (async( // c
x1// ) => {
,/* { */\u0066g =  1 /* one */ + 1 )  =>/* c */{ return "BODY"; }
),
  () => (function/* { */*/* ) */a/**/( [ // c
/**/]  =/* ) */"s",
[// ) => {

  ]/**/){ return "BODY"; }
),
  () => firstOf(class {static
* async  (x1/* => */,{ // c
_e/* => */=	(1, 2)/* c */,/* ) */...// c
\u{68}i/* c */}/* => */,{1 /* c */ :get=// c
1 /* one */ + 1/* => */}) { return "BODY"; }
}),
  () => (( [/* c */...[

]]  ,type	)/* c */=>/* c */{ return "BODY"; }
),
  () => (async (

{ of/* => */}/* c */,/*
*/c /* c */ )=>/* => */{ return "BODY"; }
),
  () => firstOf({*/* => */1e2 /* c */ ({// ) => {
[/* c */a0/* c */]/* => */:{/*
*/[/* { */a0/**/] :
await_ // c
,

let_ /* c */ } , /* c */ [`k`/* ) */]

:{/* { */... // c
_e	} , /* c */ .../**/c } ,é ,get)
{ return "BODY"; }
}),
  () => firstOf((class {async   12/* { */( set/* c */=1 /* one */ + 1/* c */,{ ...ñam// c
}/* c */,x1/* c */,... /* c */ é/* ) */){ return "BODY"; }
}).prototype),
  () => firstOf((class {get/**/1e2/* { */(	)/* => */{ return "BODY"; }
}).prototype),
  () => firstOf({["k"]/* c */(

[/* { */$d /* c */ ,/* { */let_ /* c */ ]
,/* c */[
𝓐 /* c */ , /* c */ {
[`k`
]
:/*
*/_e/* => */} /* c */ , /* c */ ...a	]
,/* c */async/* => */=  "/*" )// c
{ return "BODY"; }
}),
  () => firstOf((class {set

"s k"  ([
\u0066g ,/**/... // c
$d	] // c
)
{ return "BODY"; }
}).prototype),
  () => (async /* ) */function  x1/* ) */( \u0066g

=/*
*/1/**/)/* ) */{ return "BODY"; }
),
  () => firstOf({get	get/* { */()/* ) */{ return "BODY"; }
}),
  () => firstOf({["k"]  (	// ) => {
)/* ) */{ return "BODY"; }
}),
  () => (( // c
  ) =>/**/"BODY"
),
  () => (( { }/*
*/,// c
of =// c
a0/*
*/,// c
[/*
*/ /* c */ ]/*
*/,// c
/**/)/**/=>/*
*/"BODY"
),
  () => firstOf({*/* ) */m  ( {	...// c
async/**/} )
{ return "BODY"; }
}),
  () => (async   as=>"BODY"
),
  () => firstOf({set// ) => {
0x1f( // c
{/* ) */ /* c */ }
)	{ return "BODY"; }
}),
  () => (function/* { *//*
*/(/**/{ /* c */ [
a0/* => */] /* c */ :{ /**/}
}/* { */,// ) => {
[

]/* { */,// ) => {
[{ set/* ) */}	=/* c *//\///* => */,/* => */[/* c */c/*
*/,/**/let_/*
*/,/**/...// ) => {
\u0066g/* c */]= /* c */ { }// c
]={ }/* c */){ return "BODY"; }
),
  () => (function*
    (  /* => */)/*
*/{ return "BODY"; }
),
  () => firstOf({async  static(/* ) */\u{68}i/**/,	ñam/**/,	[ {/**/ }/* => */,/* c */{ 
}/*
*/=/*
*/class {}/* => */,/* c */... /* c */ b/* ) */]// c
) /* c */ { return "BODY"; }
}),
  () => firstOf({get 0x1f(/* ) */){ return "BODY"; }
}),
  () => (( )/* c */=>{ return "BODY"; }
),
  () => (function of (
{ [ a0 ]
:/* => */async/**/, /* c */ ...
  \u0066g/* c */}	,/**/b	,/**//*
*/)/* c */{ return "BODY"; }
),
  () => ((
type	)=>// c
{ return "BODY"; }
),
  () => firstOf(class {static/**/*/* => */\u006dn	( )/* ) */{ return "BODY"; }
}),
  () => (function   (
){ return "BODY"; }
),
  () => (async /**/(
{
b

=	1 /* one */ + 1

,

é /* c */ =/* ) */(1, 2)  }/*
*/)	=>/*
*/"BODY"
),
  () => ((async,
x1 =	x => x,
...// ) => {
{/* c */k  :	é/* => */,/* => */ñam/**/= /* c */ /[)]/ /* c */ }) =>	"BODY"
),
  () => (function* 
(

[/**/.../* => */a

]	= /* c */ 1 /* one */ + 1 /* c */ ,	c= /* c */ async q=>q /* c */ ,	get// c
=/* c */`${1}}` // c
)/* => */{ return "BODY"; }
),
  () => firstOf({"s k"(	{

let_,	1:{/* => */\u0066g
,/* => */[/* { */`k`]/* ) */: // c
b
  }
  =")",	/**/}	=a0/* c */,/**/...  é /* c */ ){ return "BODY"; }
}),
  () => (function
/* c */( /* c */ b,{  /* c */},{// ) => {
"s k"
:
{ /* c */ [
  `k`	]/* c */:	await_,

[
  1 + 1/**/]/* { */:𝓐/* => */}/* ) */= // c
1e3 ,// c
.../* c */set // c
} )  { return "BODY"; }
),
  () => (function/* c */é/* => */( /* c */ /* c */)/*
*/{ return "BODY"; }
),
  () => (( /* c */ set,/* ) */get/* => */)/* c */=>// ) => {
{ return "BODY"; }
),
  () => (async/* c */({ /* c */ /* ) */},/* ) */a,/* ) */\u{68}i= { k: 1 }/* c */)/* => */=>{ return "BODY"; }
),
  () => firstOf({set m/* c */(/* => */{/**//*
*/}/* { */)/* ) */{ return "BODY"; }
}),
  () => firstOf({async* set// c
(/* => */await_/* => */,	{[/* => */"k"/* { */]

: [/* c */],/* ) */.../**/ñam } =/=>//* => */,	b

) // c
{ return "BODY"; }
}),
  () => firstOf(class {static/* => */async
  (
[/* => */ ] =
  class { m ( q ){} }
)/*
*/{ return "BODY"; }
}),
  () => (function/* => */*  as(// ) => {
\u{68}i/* { */) /* c */ { return "BODY"; }
),
  () => (async /* c */function/* c */(/* ) */\u0066g// c
,/**/of=// c
-1)/* => */{ return "BODY"; }
),
  () => (async(/* { */𝓐/*
*/=-1/**/, [ [/* ) */// ) => {
]
  =// ) => {
(1, 2)/**/,/* ) */[/* => */await_/* c */]
]
)=> { return "BODY"; }
),
  () => ((// ) => {
/* { */)/* ) */=>/*
*/"BODY"
),
  () => firstOf({get 12
  (/* => */)// ) => {
{ return "BODY"; }
}),
  () => firstOf({m

(/**/𝓐// c
)/* => */{ return "BODY"; }
}),
  () => firstOf({set	\u006dn	(// ) => {
{  } // c
)	{ return "BODY"; }
}),
  () => (\u0066g  =>/* c */"BODY"
),
  () => firstOf({async /* { */async/* ) */(


  )/* => */{ return "BODY"; }
}),
  () => firstOf({async  * ["k"](
  ...[/*
*/ñam/* { */=1e3/**/] ) // c
{ return "BODY"; }
}),
  () => ((// ) => {
of/* { */)	=> /* c */ "BODY"
),
  () => ((/* => */\u0066g ,// ) => {
/* c */)=> /* c */ { return "BODY"; }
),
  () => (function/*
*/$d(/* { */)/* c */{ return "BODY"; }
),
  () => ((	)=> // c
"BODY"
),
  () => ((\u0066g,  b/* c */=
  /=>/,  ...a  )  =>{ return "BODY"; }
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
