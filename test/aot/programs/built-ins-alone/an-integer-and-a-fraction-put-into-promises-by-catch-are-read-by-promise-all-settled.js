const held = [Promise.reject(7).catch(reason => reason), Promise.reject(1.5).catch(reason => reason)];
const list = await Promise.allSettled(held);
console.log(list[0].value + 1, list[1].value + 1);
