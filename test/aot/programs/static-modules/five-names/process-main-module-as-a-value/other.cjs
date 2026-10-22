exports.show = () => console.log(process.mainModule === require.main, process.mainModule !== module, process.mainModule.exports.answer);
