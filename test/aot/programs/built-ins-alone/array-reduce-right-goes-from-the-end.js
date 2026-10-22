console.log(["a", "b", 1.5].reduceRight((kept, value, index) => `${kept}${value}${index}`));
