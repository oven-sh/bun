#![allow(dead_code)] // until every rule of the plugin is written
//! `lib/util/lifecycleMethods.js` of eslint-plugin-react.

pub(crate) const INSTANCE: [&str; 16] = [
    "getDefaultProps",
    "getInitialState",
    "getChildContext",
    "componentWillMount",
    "UNSAFE_componentWillMount",
    "componentDidMount",
    "componentWillReceiveProps",
    "UNSAFE_componentWillReceiveProps",
    "shouldComponentUpdate",
    "componentWillUpdate",
    "UNSAFE_componentWillUpdate",
    "getSnapshotBeforeUpdate",
    "componentDidUpdate",
    "componentDidCatch",
    "componentWillUnmount",
    "render",
];

pub(crate) const STATIC: [&str; 1] = ["getDerivedStateFromProps"];
