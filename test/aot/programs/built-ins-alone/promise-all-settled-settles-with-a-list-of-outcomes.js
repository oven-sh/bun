const list = await Promise.allSettled([Promise.resolve(1.5), Promise.reject({ code: 2.5 }), "three"]);
console.log(list[0].status, list[0].value + 1, list[0].reason === undefined, list[1].status, list[1].reason.code + 1, list[1].value === undefined, list[2].value.length);
