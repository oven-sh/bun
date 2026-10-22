console.log(await Promise.reject({ code: 1.5 }).catch(error => error.code + 1));
