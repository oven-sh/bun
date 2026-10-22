export let state: string = "before";
await Promise.resolve();
state = "after the await";
export const done: string = "done";
