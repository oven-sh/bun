const held = [Promise.reject(1.5).catch(reason => reason), Promise.reject(2.5).catch(reason => reason)];
console.log((await Promise.race(held)) + 1, (await Promise.any(held)) + 1);
