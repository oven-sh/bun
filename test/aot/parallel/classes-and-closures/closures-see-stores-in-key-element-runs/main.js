// `key` is an argument of its own of `jsx()`, so its expression runs behind the other attributes and the children, wherever it is written. A closure that one of those makes reads what the expression of `key` stores, and the parts of an element that nobody uses run in the same order.
import "./elements.jsx";
