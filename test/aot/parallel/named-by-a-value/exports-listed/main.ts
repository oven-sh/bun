import * as all from "./tools";
console.log(Object.values(all).map(tool => (tool as any)()).join(), JSON.stringify(Object.keys(all)));