// Functions without parameter types stand in a list that is handed to a callee of type any, where Bun's types are not installed.
// Alone: which types are installed is a matter of this folder's tsconfig.json
const compose: any = (steps: Function[]) => steps.map(step => step.length).join(" ");
console.log(compose([(context, next) => {}, (context, next) => {}, (context, next) => {}, context => {}]));
