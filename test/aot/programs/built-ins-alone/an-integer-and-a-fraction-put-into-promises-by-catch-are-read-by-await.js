const held = [Promise.reject(7).catch(reason => reason), Promise.reject(1.5).catch(reason => reason)];
console.log((await held[0]) + 1, (await held[1]) + 1);
