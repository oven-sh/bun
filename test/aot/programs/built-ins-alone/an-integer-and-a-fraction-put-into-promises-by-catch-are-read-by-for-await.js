const held = [Promise.reject(7).catch(reason => reason), Promise.reject(1.5).catch(reason => reason)];
for await (const value of held) console.log(value + 1);
