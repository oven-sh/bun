async function relay() { await 0; return (() => this.held)(); }
relay.call({ held: 11 }).then(value => console.log(value));
