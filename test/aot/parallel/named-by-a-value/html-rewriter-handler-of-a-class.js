class Handler { element(element) { element.setAttribute("seen", "yes"); } text(text) { if (text.text) console.log("text", text.text); } }
console.log(new HTMLRewriter().on("p", new Handler()).transform("<p>x</p>"));
