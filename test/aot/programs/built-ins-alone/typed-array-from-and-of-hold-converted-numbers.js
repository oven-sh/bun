console.log(Uint8Array.from([1.9, "2", 257]).join(), Float32Array.of(1.5, 2).join(), Int8Array.from({ length: 2 }, (value, index) => index * 200).join());
