const held = [Promise.reject(1.5).catch(reason => reason), Promise.reject(2.5).catch(reason => reason)];
await held[0].then(value => console.log(value + 1));
await held[1].then(value => console.log(value + 1));
