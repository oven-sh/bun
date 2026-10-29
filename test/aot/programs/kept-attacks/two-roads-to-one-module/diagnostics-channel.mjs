// Two roads to one module: diagnostics channel. It prints what plain Bun prints.
import * as space from "node:diagnostics_channel";
import whole from "node:diagnostics_channel";
import { Channel as named_Channel, channel as named_channel, hasSubscribers as named_hasSubscribers, subscribe as named_subscribe, tracingChannel as named_tracingChannel, unsubscribe as named_unsubscribe } from "node:diagnostics_channel";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const required = require("node:diagnostics_channel");
const asked = process.getBuiltinModule("node:diagnostics_channel");
function same(name, ...answers) { console.log(name + " " + answers.map(answer => (answer ? "T" : "F")).join("")); }
same("Channel", named_Channel === space.Channel, named_Channel === whole.Channel, named_Channel === required.Channel, named_Channel === asked.Channel, space.Channel === required.Channel, whole.Channel === required.Channel, asked.Channel === required.Channel, whole.Channel === space.Channel);
same("channel", named_channel === space.channel, named_channel === whole.channel, named_channel === required.channel, named_channel === asked.channel, space.channel === required.channel, whole.channel === required.channel, asked.channel === required.channel, whole.channel === space.channel);
same("hasSubscribers", named_hasSubscribers === space.hasSubscribers, named_hasSubscribers === whole.hasSubscribers, named_hasSubscribers === required.hasSubscribers, named_hasSubscribers === asked.hasSubscribers, space.hasSubscribers === required.hasSubscribers, whole.hasSubscribers === required.hasSubscribers, asked.hasSubscribers === required.hasSubscribers, whole.hasSubscribers === space.hasSubscribers);
same("subscribe", named_subscribe === space.subscribe, named_subscribe === whole.subscribe, named_subscribe === required.subscribe, named_subscribe === asked.subscribe, space.subscribe === required.subscribe, whole.subscribe === required.subscribe, asked.subscribe === required.subscribe, whole.subscribe === space.subscribe);
same("tracingChannel", named_tracingChannel === space.tracingChannel, named_tracingChannel === whole.tracingChannel, named_tracingChannel === required.tracingChannel, named_tracingChannel === asked.tracingChannel, space.tracingChannel === required.tracingChannel, whole.tracingChannel === required.tracingChannel, asked.tracingChannel === required.tracingChannel, whole.tracingChannel === space.tracingChannel);
same("unsubscribe", named_unsubscribe === space.unsubscribe, named_unsubscribe === whole.unsubscribe, named_unsubscribe === required.unsubscribe, named_unsubscribe === asked.unsubscribe, space.unsubscribe === required.unsubscribe, whole.unsubscribe === required.unsubscribe, asked.unsubscribe === required.unsubscribe, whole.unsubscribe === space.unsubscribe);
