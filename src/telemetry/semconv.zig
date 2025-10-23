//! OpenTelemetry Semantic Conventions
//!
//! Auto-generated from @opentelemetry/semantic-conventions
//! DO NOT EDIT - run `bun run packages/bun-otel/scripts/generate-semconv.ts`

const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const JSC = bun.jsc;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const ZigString = JSC.ZigString;

// ============================================================================
// HeaderNameList - Pre-processed configuration for efficient header capture
// ============================================================================

/// Pre-processed header name list for efficient header capture/propagation
/// Stores header names as bun.String for fast lookups during request processing
pub const HeaderNameList = struct {
    /// Header names as bun.String (case-insensitive lookup ready)
    header_names: std.ArrayList(bun.String),

    /// Context for building full attribute names (e.g., CONTEXT_SERVER_REQUEST)
    context: u16,

    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator, context: u16) HeaderNameList {
        return .{
            .header_names = std.ArrayList(bun.String).init(allocator),
            .context = context,
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *HeaderNameList) void {
        for (self.header_names.items) |str| {
            str.deref();
        }
        self.header_names.deinit();
    }

    /// Parse a JS array of header name strings into the list
    pub fn fromJS(allocator: std.mem.Allocator, global: *JSGlobalObject, js_array: JSValue, context: u16) !HeaderNameList {
        var list = HeaderNameList.init(allocator, context);
        errdefer list.deinit();

        const len = try js_array.getLength(global);
        var i: u32 = 0;
        while (i < len) : (i += 1) {
            const name_js = try js_array.getIndex(global, i);
            if (!name_js.isString()) continue;

            var name_zig: ZigString = ZigString.Empty;
            try name_js.toZigString(&name_zig, global);
            const name_slice = name_zig.toSlice(allocator);
            defer name_slice.deinit();

            // Store as bun.String for efficient lookups
            const name_str = bun.String.fromBytes(name_slice.slice());
            try list.header_names.append(name_str);
        }

        return list;
    }

    /// Convert back to JS array for debugging/serialization
    pub fn toJS(self: *const HeaderNameList, global: *JSGlobalObject) JSValue {
        const array = JSValue.createEmptyArray(global, @intCast(self.header_names.items.len));

        for (self.header_names.items, 0..) |name_str, i| {
            const name_js = name_str.toJS(global);
            array.putIndex(global, @intCast(i), name_js);
        }

        return array;
    }
};

// ============================================================================
// Context Namespace Constants (for header attribute naming)
// ============================================================================

pub const CONTEXT_BASE: u16 = 0x0000;
pub const CONTEXT_SERVER_REQUEST: u16 = 0x0200;
pub const CONTEXT_SERVER_RESPONSE: u16 = 0x0300;
pub const CONTEXT_FETCH_REQUEST: u16 = 0x0500;
pub const CONTEXT_FETCH_RESPONSE: u16 = 0x0700;

// ============================================================================
// Semantic Convention Constants
// ============================================================================

pub const ATTR_ASPNETCORE_DIAGNOSTICS_EXCEPTION_RESULT = "aspnetcore.diagnostics.exception.result";
pub const ATTR_ASPNETCORE_DIAGNOSTICS_HANDLER_TYPE = "aspnetcore.diagnostics.handler.type";
pub const ATTR_ASPNETCORE_RATE_LIMITING_POLICY = "aspnetcore.rate_limiting.policy";
pub const ATTR_ASPNETCORE_RATE_LIMITING_RESULT = "aspnetcore.rate_limiting.result";
pub const ATTR_ASPNETCORE_REQUEST_IS_UNHANDLED = "aspnetcore.request.is_unhandled";
pub const ATTR_ASPNETCORE_ROUTING_IS_FALLBACK = "aspnetcore.routing.is_fallback";
pub const ATTR_ASPNETCORE_ROUTING_MATCH_STATUS = "aspnetcore.routing.match_status";
pub const ATTR_ASPNETCORE_USER_IS_AUTHENTICATED = "aspnetcore.user.is_authenticated";
pub const ATTR_CLIENT_ADDRESS = "client.address";
pub const ATTR_CLIENT_PORT = "client.port";
pub const ATTR_CODE_COLUMN_NUMBER = "code.column.number";
pub const ATTR_CODE_FILE_PATH = "code.file.path";
pub const ATTR_CODE_FUNCTION_NAME = "code.function.name";
pub const ATTR_CODE_LINE_NUMBER = "code.line.number";
pub const ATTR_CODE_STACKTRACE = "code.stacktrace";
pub const ATTR_DB_COLLECTION_NAME = "db.collection.name";
pub const ATTR_DB_NAMESPACE = "db.namespace";
pub const ATTR_DB_OPERATION_BATCH_SIZE = "db.operation.batch.size";
pub const ATTR_DB_OPERATION_NAME = "db.operation.name";
pub const ATTR_DB_QUERY_SUMMARY = "db.query.summary";
pub const ATTR_DB_QUERY_TEXT = "db.query.text";
pub const ATTR_DB_RESPONSE_STATUS_CODE = "db.response.status_code";
pub const ATTR_DB_STORED_PROCEDURE_NAME = "db.stored_procedure.name";
pub const ATTR_DB_SYSTEM_NAME = "db.system.name";
pub const ATTR_DOTNET_GC_HEAP_GENERATION = "dotnet.gc.heap.generation";
pub const ATTR_ERROR_TYPE = "error.type";
pub const ATTR_EXCEPTION_ESCAPED = "exception.escaped";
pub const ATTR_EXCEPTION_MESSAGE = "exception.message";
pub const ATTR_EXCEPTION_STACKTRACE = "exception.stacktrace";
pub const ATTR_EXCEPTION_TYPE = "exception.type";
pub const ATTR_HTTP_REQUEST_METHOD = "http.request.method";
pub const ATTR_HTTP_REQUEST_METHOD_ORIGINAL = "http.request.method_original";
pub const ATTR_HTTP_REQUEST_RESEND_COUNT = "http.request.resend_count";
pub const ATTR_HTTP_RESPONSE_STATUS_CODE = "http.response.status_code";
pub const ATTR_HTTP_ROUTE = "http.route";
pub const ATTR_JVM_GC_ACTION = "jvm.gc.action";
pub const ATTR_JVM_GC_NAME = "jvm.gc.name";
pub const ATTR_JVM_MEMORY_POOL_NAME = "jvm.memory.pool.name";
pub const ATTR_JVM_MEMORY_TYPE = "jvm.memory.type";
pub const ATTR_JVM_THREAD_DAEMON = "jvm.thread.daemon";
pub const ATTR_JVM_THREAD_STATE = "jvm.thread.state";
pub const ATTR_NETWORK_LOCAL_ADDRESS = "network.local.address";
pub const ATTR_NETWORK_LOCAL_PORT = "network.local.port";
pub const ATTR_NETWORK_PEER_ADDRESS = "network.peer.address";
pub const ATTR_NETWORK_PEER_PORT = "network.peer.port";
pub const ATTR_NETWORK_PROTOCOL_NAME = "network.protocol.name";
pub const ATTR_NETWORK_PROTOCOL_VERSION = "network.protocol.version";
pub const ATTR_NETWORK_TRANSPORT = "network.transport";
pub const ATTR_NETWORK_TYPE = "network.type";
pub const ATTR_OTEL_SCOPE_NAME = "otel.scope.name";
pub const ATTR_OTEL_SCOPE_VERSION = "otel.scope.version";
pub const ATTR_OTEL_STATUS_CODE = "otel.status_code";
pub const ATTR_OTEL_STATUS_DESCRIPTION = "otel.status_description";
pub const ATTR_SERVER_ADDRESS = "server.address";
pub const ATTR_SERVER_PORT = "server.port";
pub const ATTR_SERVICE_NAME = "service.name";
pub const ATTR_SERVICE_VERSION = "service.version";
pub const ATTR_SIGNALR_CONNECTION_STATUS = "signalr.connection.status";
pub const ATTR_SIGNALR_TRANSPORT = "signalr.transport";
pub const ATTR_TELEMETRY_SDK_LANGUAGE = "telemetry.sdk.language";
pub const ATTR_TELEMETRY_SDK_NAME = "telemetry.sdk.name";
pub const ATTR_TELEMETRY_SDK_VERSION = "telemetry.sdk.version";
pub const ATTR_URL_FRAGMENT = "url.fragment";
pub const ATTR_URL_FULL = "url.full";
pub const ATTR_URL_PATH = "url.path";
pub const ATTR_URL_QUERY = "url.query";
pub const ATTR_URL_SCHEME = "url.scheme";
pub const ATTR_USER_AGENT_ORIGINAL = "user_agent.original";
pub const SEMATTRS_AWS_DYNAMODB_ATTRIBUTE_DEFINITIONS = "aws.dynamodb.attribute_definitions";
pub const SEMATTRS_AWS_DYNAMODB_ATTRIBUTES_TO_GET = "aws.dynamodb.attributes_to_get";
pub const SEMATTRS_AWS_DYNAMODB_CONSISTENT_READ = "aws.dynamodb.consistent_read";
pub const SEMATTRS_AWS_DYNAMODB_CONSUMED_CAPACITY = "aws.dynamodb.consumed_capacity";
pub const SEMATTRS_AWS_DYNAMODB_COUNT = "aws.dynamodb.count";
pub const SEMATTRS_AWS_DYNAMODB_EXCLUSIVE_START_TABLE = "aws.dynamodb.exclusive_start_table";
pub const SEMATTRS_AWS_DYNAMODB_GLOBAL_SECONDARY_INDEX_UPDATES = "aws.dynamodb.global_secondary_index_updates";
pub const SEMATTRS_AWS_DYNAMODB_GLOBAL_SECONDARY_INDEXES = "aws.dynamodb.global_secondary_indexes";
pub const SEMATTRS_AWS_DYNAMODB_INDEX_NAME = "aws.dynamodb.index_name";
pub const SEMATTRS_AWS_DYNAMODB_ITEM_COLLECTION_METRICS = "aws.dynamodb.item_collection_metrics";
pub const SEMATTRS_AWS_DYNAMODB_LIMIT = "aws.dynamodb.limit";
pub const SEMATTRS_AWS_DYNAMODB_LOCAL_SECONDARY_INDEXES = "aws.dynamodb.local_secondary_indexes";
pub const SEMATTRS_AWS_DYNAMODB_PROJECTION = "aws.dynamodb.projection";
pub const SEMATTRS_AWS_DYNAMODB_PROVISIONED_READ_CAPACITY = "aws.dynamodb.provisioned_read_capacity";
pub const SEMATTRS_AWS_DYNAMODB_PROVISIONED_WRITE_CAPACITY = "aws.dynamodb.provisioned_write_capacity";
pub const SEMATTRS_AWS_DYNAMODB_SCAN_FORWARD = "aws.dynamodb.scan_forward";
pub const SEMATTRS_AWS_DYNAMODB_SCANNED_COUNT = "aws.dynamodb.scanned_count";
pub const SEMATTRS_AWS_DYNAMODB_SEGMENT = "aws.dynamodb.segment";
pub const SEMATTRS_AWS_DYNAMODB_SELECT = "aws.dynamodb.select";
pub const SEMATTRS_AWS_DYNAMODB_TABLE_COUNT = "aws.dynamodb.table_count";
pub const SEMATTRS_AWS_DYNAMODB_TABLE_NAMES = "aws.dynamodb.table_names";
pub const SEMATTRS_AWS_DYNAMODB_TOTAL_SEGMENTS = "aws.dynamodb.total_segments";
pub const SEMATTRS_AWS_LAMBDA_INVOKED_ARN = "aws.lambda.invoked_arn";
pub const SEMATTRS_CODE_FILEPATH = "code.filepath";
pub const SEMATTRS_CODE_FUNCTION = "code.function";
pub const SEMATTRS_CODE_LINENO = "code.lineno";
pub const SEMATTRS_CODE_NAMESPACE = "code.namespace";
pub const SEMATTRS_DB_CASSANDRA_CONSISTENCY_LEVEL = "db.cassandra.consistency_level";
pub const SEMATTRS_DB_CASSANDRA_COORDINATOR_DC = "db.cassandra.coordinator.dc";
pub const SEMATTRS_DB_CASSANDRA_COORDINATOR_ID = "db.cassandra.coordinator.id";
pub const SEMATTRS_DB_CASSANDRA_IDEMPOTENCE = "db.cassandra.idempotence";
pub const SEMATTRS_DB_CASSANDRA_KEYSPACE = "db.cassandra.keyspace";
pub const SEMATTRS_DB_CASSANDRA_PAGE_SIZE = "db.cassandra.page_size";
pub const SEMATTRS_DB_CASSANDRA_SPECULATIVE_EXECUTION_COUNT = "db.cassandra.speculative_execution_count";
pub const SEMATTRS_DB_CASSANDRA_TABLE = "db.cassandra.table";
pub const SEMATTRS_DB_CONNECTION_STRING = "db.connection_string";
pub const SEMATTRS_DB_HBASE_NAMESPACE = "db.hbase.namespace";
pub const SEMATTRS_DB_JDBC_DRIVER_CLASSNAME = "db.jdbc.driver_classname";
pub const SEMATTRS_DB_MONGODB_COLLECTION = "db.mongodb.collection";
pub const SEMATTRS_DB_MSSQL_INSTANCE_NAME = "db.mssql.instance_name";
pub const SEMATTRS_DB_NAME = "db.name";
pub const SEMATTRS_DB_OPERATION = "db.operation";
pub const SEMATTRS_DB_REDIS_DATABASE_INDEX = "db.redis.database_index";
pub const SEMATTRS_DB_SQL_TABLE = "db.sql.table";
pub const SEMATTRS_DB_STATEMENT = "db.statement";
pub const SEMATTRS_DB_SYSTEM = "db.system";
pub const SEMATTRS_DB_USER = "db.user";
pub const SEMATTRS_ENDUSER_ID = "enduser.id";
pub const SEMATTRS_ENDUSER_ROLE = "enduser.role";
pub const SEMATTRS_ENDUSER_SCOPE = "enduser.scope";
pub const SEMATTRS_EXCEPTION_ESCAPED = "exception.escaped";
pub const SEMATTRS_EXCEPTION_MESSAGE = "exception.message";
pub const SEMATTRS_EXCEPTION_STACKTRACE = "exception.stacktrace";
pub const SEMATTRS_EXCEPTION_TYPE = "exception.type";
pub const SEMATTRS_FAAS_COLDSTART = "faas.coldstart";
pub const SEMATTRS_FAAS_CRON = "faas.cron";
pub const SEMATTRS_FAAS_DOCUMENT_COLLECTION = "faas.document.collection";
pub const SEMATTRS_FAAS_DOCUMENT_NAME = "faas.document.name";
pub const SEMATTRS_FAAS_DOCUMENT_OPERATION = "faas.document.operation";
pub const SEMATTRS_FAAS_DOCUMENT_TIME = "faas.document.time";
pub const SEMATTRS_FAAS_EXECUTION = "faas.execution";
pub const SEMATTRS_FAAS_INVOKED_NAME = "faas.invoked_name";
pub const SEMATTRS_FAAS_INVOKED_PROVIDER = "faas.invoked_provider";
pub const SEMATTRS_FAAS_INVOKED_REGION = "faas.invoked_region";
pub const SEMATTRS_FAAS_TIME = "faas.time";
pub const SEMATTRS_FAAS_TRIGGER = "faas.trigger";
pub const SEMATTRS_HTTP_CLIENT_IP = "http.client_ip";
pub const SEMATTRS_HTTP_FLAVOR = "http.flavor";
pub const SEMATTRS_HTTP_HOST = "http.host";
pub const SEMATTRS_HTTP_METHOD = "http.method";
pub const SEMATTRS_HTTP_REQUEST_CONTENT_LENGTH = "http.request_content_length";
pub const SEMATTRS_HTTP_REQUEST_CONTENT_LENGTH_UNCOMPRESSED = "http.request_content_length_uncompressed";
pub const SEMATTRS_HTTP_RESPONSE_CONTENT_LENGTH = "http.response_content_length";
pub const SEMATTRS_HTTP_RESPONSE_CONTENT_LENGTH_UNCOMPRESSED = "http.response_content_length_uncompressed";
pub const SEMATTRS_HTTP_ROUTE = "http.route";
pub const SEMATTRS_HTTP_SCHEME = "http.scheme";
pub const SEMATTRS_HTTP_SERVER_NAME = "http.server_name";
pub const SEMATTRS_HTTP_STATUS_CODE = "http.status_code";
pub const SEMATTRS_HTTP_TARGET = "http.target";
pub const SEMATTRS_HTTP_URL = "http.url";
pub const SEMATTRS_HTTP_USER_AGENT = "http.user_agent";
pub const SEMATTRS_MESSAGE_COMPRESSED_SIZE = "message.compressed_size";
pub const SEMATTRS_MESSAGE_ID = "message.id";
pub const SEMATTRS_MESSAGE_TYPE = "message.type";
pub const SEMATTRS_MESSAGE_UNCOMPRESSED_SIZE = "message.uncompressed_size";
pub const SEMATTRS_MESSAGING_CONSUMER_ID = "messaging.consumer_id";
pub const SEMATTRS_MESSAGING_CONVERSATION_ID = "messaging.conversation_id";
pub const SEMATTRS_MESSAGING_DESTINATION = "messaging.destination";
pub const SEMATTRS_MESSAGING_DESTINATION_KIND = "messaging.destination_kind";
pub const SEMATTRS_MESSAGING_KAFKA_CLIENT_ID = "messaging.kafka.client_id";
pub const SEMATTRS_MESSAGING_KAFKA_CONSUMER_GROUP = "messaging.kafka.consumer_group";
pub const SEMATTRS_MESSAGING_KAFKA_MESSAGE_KEY = "messaging.kafka.message_key";
pub const SEMATTRS_MESSAGING_KAFKA_PARTITION = "messaging.kafka.partition";
pub const SEMATTRS_MESSAGING_KAFKA_TOMBSTONE = "messaging.kafka.tombstone";
pub const SEMATTRS_MESSAGING_MESSAGE_ID = "messaging.message_id";
pub const SEMATTRS_MESSAGING_MESSAGE_PAYLOAD_COMPRESSED_SIZE_BYTES = "messaging.message_payload_compressed_size_bytes";
pub const SEMATTRS_MESSAGING_MESSAGE_PAYLOAD_SIZE_BYTES = "messaging.message_payload_size_bytes";
pub const SEMATTRS_MESSAGING_OPERATION = "messaging.operation";
pub const SEMATTRS_MESSAGING_PROTOCOL = "messaging.protocol";
pub const SEMATTRS_MESSAGING_PROTOCOL_VERSION = "messaging.protocol_version";
pub const SEMATTRS_MESSAGING_RABBITMQ_ROUTING_KEY = "messaging.rabbitmq.routing_key";
pub const SEMATTRS_MESSAGING_SYSTEM = "messaging.system";
pub const SEMATTRS_MESSAGING_TEMP_DESTINATION = "messaging.temp_destination";
pub const SEMATTRS_MESSAGING_URL = "messaging.url";
pub const SEMATTRS_NET_HOST_CARRIER_ICC = "net.host.carrier.icc";
pub const SEMATTRS_NET_HOST_CARRIER_MCC = "net.host.carrier.mcc";
pub const SEMATTRS_NET_HOST_CARRIER_MNC = "net.host.carrier.mnc";
pub const SEMATTRS_NET_HOST_CARRIER_NAME = "net.host.carrier.name";
pub const SEMATTRS_NET_HOST_CONNECTION_SUBTYPE = "net.host.connection.subtype";
pub const SEMATTRS_NET_HOST_CONNECTION_TYPE = "net.host.connection.type";
pub const SEMATTRS_NET_HOST_IP = "net.host.ip";
pub const SEMATTRS_NET_HOST_NAME = "net.host.name";
pub const SEMATTRS_NET_HOST_PORT = "net.host.port";
pub const SEMATTRS_NET_PEER_IP = "net.peer.ip";
pub const SEMATTRS_NET_PEER_NAME = "net.peer.name";
pub const SEMATTRS_NET_PEER_PORT = "net.peer.port";
pub const SEMATTRS_NET_TRANSPORT = "net.transport";
pub const SEMATTRS_PEER_SERVICE = "peer.service";
pub const SEMATTRS_RPC_GRPC_STATUS_CODE = "rpc.grpc.status_code";
pub const SEMATTRS_RPC_JSONRPC_ERROR_CODE = "rpc.jsonrpc.error_code";
pub const SEMATTRS_RPC_JSONRPC_ERROR_MESSAGE = "rpc.jsonrpc.error_message";
pub const SEMATTRS_RPC_JSONRPC_REQUEST_ID = "rpc.jsonrpc.request_id";
pub const SEMATTRS_RPC_JSONRPC_VERSION = "rpc.jsonrpc.version";
pub const SEMATTRS_RPC_METHOD = "rpc.method";
pub const SEMATTRS_RPC_SERVICE = "rpc.service";
pub const SEMATTRS_RPC_SYSTEM = "rpc.system";
pub const SEMATTRS_THREAD_ID = "thread.id";
pub const SEMATTRS_THREAD_NAME = "thread.name";
