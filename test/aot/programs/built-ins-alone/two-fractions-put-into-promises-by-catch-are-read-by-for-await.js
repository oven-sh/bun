const held = [Promise.reject(1.5).catch(reason => reason), Promise.reject(2.5).catch(reason => reason)];
for await (const value of held) console.log(value + 1);
