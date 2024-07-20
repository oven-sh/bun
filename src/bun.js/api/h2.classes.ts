import { define } from "../../codegen/class-definitions";

export default [
	define({
		name: "H2FrameParser",
		JSType: "0b11101110",
		proto: {
			request: {
				fn: "request",
				length: 2,
			},
			ping: {
				fn: "ping",
				length: 0,
			},
			goaway: {
				fn: "goaway",
				length: 3,
			},
			getCurrentState: {
				fn: "getCurrentState",
				length: 0,
			},
			settings: {
				fn: "updateSettings",
				length: 1,
			},
			read: {
				fn: "read",
				length: 1,
			},
			rstStream: {
				fn: "rstStream",
				length: 1,
			},
			writeStream: {
				fn: "writeStream",
				length: 3,
			},
			sendTrailers: {
				fn: "sendTrailers",
				length: 2,
			},
			setStreamPriority: {
				fn: "setStreamPriority",
				length: 2,
			},
			getStreamContext: {
				fn: "getStreamContext",
				length: 1,
			},
			setStreamContext: {
				fn: "setStreamContext",
				length: 2,
			},
			setEndAfterHeaders: {
				fn: "setEndAfterHeaders",
				length: 2,
			},
			getEndAfterHeaders: {
				fn: "getEndAfterHeaders",
				length: 1,
			},
			isStreamAborted: {
				fn: "isStreamAborted",
				length: 1,
			},
			getStreamState: {
				fn: "getStreamState",
				length: 1,
			},
			hasNativeRead: {
				fn: "hasNativeRead",
				length: 1,
			},
			getAllStreams: {
				fn: "getAllStreams",
				length: 0,
			},
			emitErrorToAllStreams: {
				fn: "emitErrorToAllStreams",
				length: 1,
			},
			getNextStream: {
				fn: "getNextStream",
				length: 0,
			},
		},
		finalize: true,
		construct: true,
		klass: {},
	}),
];
