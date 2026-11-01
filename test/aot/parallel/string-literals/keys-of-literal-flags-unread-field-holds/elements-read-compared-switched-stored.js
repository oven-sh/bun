// A literal of 24 flags, as a minifier writes it, is asked for its keys. One of the keys is also the text that a constructor stores into a field which nothing reads: the store goes, and with it the only place
// where code spells that text. The list of keys is typed by all 24 texts and holds all 24. It is kept, joined, searched, put into a Set, walked, compared, switched on and stored into fields.
var flags={alpha:!0,bravo:!0,charlie:!0,delta:!0,echo:!0,foxtrot:!0,golf:!0,hotel:!0,india:!0,juliet:!0,kilo:!0,lima:!0,mike:!0,november:!0,oscar:!0,papa:!0,quebec:!0,romeo:!0,sierra:!0,tango:!0,uniform:!0,victor:!0,whiskey:!0,xray:!0},names=Object.keys(flags);
function Tag(n){this.kind="alpha";this.n=n}
var tags=[new Tag(1),new Tag(2)],made="al"+(process.argv[9]||"pha");
function size(){return names.length}
function has(n){return flags[n]===!0}
function lists(n){return names.includes(n)}
function rank(n){switch(n){case"bravo":return 2;case"xray":return 24;default:return n.charCodeAt(0)}}
function Box(n){this.name=n}
console.log(tags[0].n+tags[1].n,size(),names.join());
console.log(has("golf"),has(made),has("zulu"),lists(made),lists("zulu"),names.indexOf(made));
var set=new Set(Object.keys(flags));
console.log(set.size,set.has("golf"),set.has(made));
var seen=[];for(var k in flags)seen.push(k);
console.log(seen.length,seen[0]===made,seen.join()===names.join());
var pairs=Object.entries(flags);
console.log(pairs.length,pairs[0][0],pairs[0][0]===made,pairs[0][1]);
var more={...flags,zulu:!1};
console.log(Object.keys(more).length,more.zulu,more.alpha);
var first=names[0];
console.log(first===made,first==made,first.length,first+"!",flags[first],JSON.stringify([first]),typeof first,[first].includes(made),new Set([first]).has(made),new Map([[first,1]]).get(made),{alpha:5}[first]);
console.log(names.map(rank).join());
var boxes=names.map(function(n){return new Box(n)});
console.log(boxes[0].name===made,boxes[0].name,boxes.filter(function(b){return b.name===made}).length,boxes.findIndex(function(b){return b.name==="bravo"}));
console.log(Object.keys(flags).filter(function(n){return n.length>5}).map(function(n){return n.toUpperCase()}).join());
