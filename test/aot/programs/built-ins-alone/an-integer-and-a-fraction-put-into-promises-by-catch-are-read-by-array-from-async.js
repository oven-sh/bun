const held = [Promise.reject(7).catch(reason => reason), Promise.reject(1.5).catch(reason => reason)];
const list = await Array.fromAsync(held);
console.log(list.length);
console.log(list[0] + 1, list[1] + 1);
