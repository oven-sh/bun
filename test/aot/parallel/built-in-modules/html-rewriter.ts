console.log(new HTMLRewriter().on("b", { element: element => void element.setInnerContent("c") }).transform("<b>a</b>"));

export {};
