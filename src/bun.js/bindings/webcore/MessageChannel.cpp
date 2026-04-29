#include "config.h"
#include "MessageChannel.h"

#include "MessagePort.h"
#include "MessagePortPipe.h"
#include "ScriptExecutionContext.h"

namespace WebCore {

static std::pair<Ref<MessagePort>, Ref<MessagePort>> generateMessagePorts(ScriptExecutionContext& context)
{
    auto pipe = MessagePortPipe::create();
    return { MessagePort::create(context, pipe.copyRef(), 0), MessagePort::create(context, WTF::move(pipe), 1) };
}

Ref<MessageChannel> MessageChannel::create(ScriptExecutionContext& context)
{
    return adoptRef(*new MessageChannel(context));
}

MessageChannel::MessageChannel(ScriptExecutionContext& context)
    : m_ports(generateMessagePorts(context))
{
}

MessageChannel::~MessageChannel() = default;

} // namespace WebCore
