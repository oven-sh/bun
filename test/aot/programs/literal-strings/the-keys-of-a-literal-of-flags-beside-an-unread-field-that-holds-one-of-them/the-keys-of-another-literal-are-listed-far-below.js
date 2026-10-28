// The body of the module begins with a literal of 24 flags that is only ever asked by name. Far below, the keys of another literal are listed, and one of those is the text of a field that nothing reads.
var flags={alpha:!0,bravo:!0,charlie:!0,delta:!0,echo:!0,foxtrot:!0,golf:!0,hotel:!0,india:!0,juliet:!0,kilo:!0,lima:!0,mike:!0,november:!0,oscar:!0,papa:!0,quebec:!0,romeo:!0,sierra:!0,tango:!0,uniform:!0,victor:!0,whiskey:!0,xray:!0},other=[1,2,3];
function has(n){return flags[n]===!0}
console.log(has("golf"),has(process.argv[9]||"zulu"),other.length);
function Tag(n){this.kind="width";this.n=n}
var tags=[new Tag(1),new Tag(2)];
console.log(tags[0].n+tags[1].n);
var sizes={width:1,height:2};
var names=Object.keys(sizes);
console.log(names.length);
