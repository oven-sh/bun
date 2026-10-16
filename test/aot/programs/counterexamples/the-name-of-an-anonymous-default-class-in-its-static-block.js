// `export default class {}` is named "default" already when its static block runs.
export default class { static { console.log(JSON.stringify(this.name)); } }
